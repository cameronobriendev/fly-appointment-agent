/**
 * Twilio WebSocket stream handler for standalone appointment booking
 * Orchestrates the entire conversation flow:
 * 1. Load configuration from environment variables
 * 2. Use hardcoded appointment booking prompt
 * 3. Handle Twilio audio stream
 * 4. Coordinate STT → LLM → TTS pipeline
 * 5. Book appointments via Google Calendar
 * 6. Save appointment data to database
 */

import { APPOINTMENT_BOOKING_PROMPT } from '../prompts/appointment-booking.js';
import { APPOINTMENT_TOOLS } from '../prompts/appointment-tools.js';
import { checkAvailability, getAvailableSlots, createAppointment as createCalendarAppointment } from './google-calendar.js';
import { sendAppointmentConfirmation } from './sms.js';
import { createAppointment as createDbAppointment, createCallLog, updateCallLog } from '../db/queries.js';
import { DeepgramService } from './deepgram.js';
import { CartesiaService } from './cartesia.js';
import { LLMRouter } from './llm-router.js';
import { onCallStart, onCallEnd } from './metrics.js';
import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const twilioLogger = logger.child('TWILIO');

// Load ringback audio at module level (PCM 16-bit 8kHz WAV, needs conversion to mulaw)
let ringbackAudioRaw = null;
try {
  const ringbackPath = path.join(__dirname, '../../public/ringback-pattern.wav');
  ringbackAudioRaw = fs.readFileSync(ringbackPath);
  twilioLogger.info('Ringback audio loaded', {
    path: ringbackPath,
    size: ringbackAudioRaw.length,
  });
} catch (error) {
  twilioLogger.error('Failed to load ringback audio', error);
}

/**
 * Handle Twilio WebSocket stream
 * @param {WebSocket} ws - WebSocket connection from Twilio
 */
export async function handleTwilioStream(ws) {
  // Call state
  let callSid = null;
  let streamSid = null;
  let fromNumber = null;
  let toNumber = null;
  let startTime = null;
  let endTime = null;

  // Conversation state
  const messages = []; // LLM conversation history
  const transcript = []; // Full conversation transcript
  const appointmentData = {
    // Data collected during call
    callerName: null,
    callerPhone: null,
    preferredDate: null,
    preferredTime: null,
    reason: null,
    notes: null,
    appointmentBooked: false,
    appointmentId: null,
    googleCalendarEventId: null,
    timezoneOffset: null, // Offset in hours from UTC (e.g., -8 for PST)
    callerLocalTime: null, // Caller's current local time
  };

  // Services
  let deepgram = null;
  let deepgramConnection = null;
  let cartesia = null;
  let cartesiaConnection = null;
  let llmRouter = null;

  // Metrics
  let llmCalls = 0;
  let totalLatency = 0;
  let totalCost = 0;
  let primaryProvider = null;

  /**
   * Convert 16-bit PCM sample to 8-bit mulaw
   * Mulaw is logarithmic compression used by Twilio Media Streams
   */
  function pcmToMulaw(pcm) {
    const MULAW_MAX = 0x1FFF;
    const MULAW_BIAS = 33;
    let mask = 0x1000;
    let sign = 0;
    let position = 12;
    let lsb = 0;

    // Get sign and absolute value
    if (pcm < 0) {
      pcm = -pcm;
      sign = 0x80;
    }

    // Add bias
    pcm += MULAW_BIAS;
    if (pcm > MULAW_MAX) pcm = MULAW_MAX;

    // Convert to mulaw
    for (; position >= 5; position--, mask >>= 1) {
      if (pcm & mask) break;
    }

    lsb = (pcm >> (position - 4)) & 0x0F;
    return ~(sign | ((position - 5) << 4) | lsb);
  }

  /**
   * Send ringback audio through WebSocket to Twilio
   * Plays while services initialize in parallel
   */
  async function sendRingbackAudio() {
    if (!ringbackAudioRaw || !streamSid) {
      twilioLogger.warn('Cannot send ringback - audio or streamSid missing');
      return;
    }

    try {
      twilioLogger.info('Sending ringback audio through WebSocket', {
        callSid,
        audioSize: ringbackAudioRaw.length,
      });

      // Skip WAV header (44 bytes) and get PCM data
      const pcmData = ringbackAudioRaw.slice(44);
      const mulawData = Buffer.alloc(pcmData.length / 2); // 16-bit PCM to 8-bit mulaw

      // Convert PCM 16-bit to mulaw 8-bit
      for (let i = 0; i < pcmData.length; i += 2) {
        const pcmSample = pcmData.readInt16LE(i);
        mulawData[i / 2] = pcmToMulaw(pcmSample);
      }

      // Send audio in chunks (Twilio expects 20ms chunks = 160 bytes at 8kHz mulaw)
      const CHUNK_SIZE = 160; // 20ms of 8kHz mulaw audio
      for (let offset = 0; offset < mulawData.length; offset += CHUNK_SIZE) {
        const chunk = mulawData.slice(offset, offset + CHUNK_SIZE);
        const base64Audio = chunk.toString('base64');

        ws.send(
          JSON.stringify({
            event: 'media',
            streamSid: streamSid,
            media: {
              payload: base64Audio,
            },
          })
        );

        // Wait 20ms between chunks to match real-time playback
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      twilioLogger.info('Ringback audio sent successfully', {
        callSid,
        chunks: Math.ceil(mulawData.length / CHUNK_SIZE),
        duration: `${(mulawData.length / 8000).toFixed(1)}s`,
      });
    } catch (error) {
      twilioLogger.error('Error sending ringback audio', error);
    }
  }

  /**
   * Format phone number for natural speech
   * Converts +15551234567 to (555) 123-4567 so TTS reads it naturally
   * @param {string} phoneNumber - E.164 format phone number
   * @returns {string} Formatted phone number for speech
   */
  function formatPhoneForSpeech(phoneNumber) {
    // Remove +1 country code for US numbers
    let digits = phoneNumber.replace(/^\+1/, '').replace(/\D/g, '');

    if (digits.length === 10) {
      // Format as (555) 123-4567
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }

    // For non-US numbers, just remove the + so it doesn't say "plus"
    return phoneNumber.replace('+', '');
  }

  /**
   * Get initial greeting for appointment booking
   * @returns {string} Initial greeting text (shorter = less latency)
   */
  function getInitialGreeting() {
    const businessName = process.env.BUSINESS_NAME || "Dr. Smith's Dental Office";

    twilioLogger.info('Using appointment booking greeting', {
      callSid,
      businessName
    });

    // Direct and concise greeting for minimal latency
    return `Thanks for calling ${businessName}. Would you like to book an appointment?`;
  }

  /**
   * Initialize services for appointment booking
   * NEW FLOW: Plays ringback FIRST, initializes Deepgram during ringback,
   * then connects Cartesia AFTER ringback completes (prevents WebSocket idle timeout)
   */
  async function initialize(twilioNumber, callerNumber) {
    try {
      const initStartTime = Date.now();

      twilioLogger.info('Starting initialization with ringback', {
        callSid,
        twilioNumber,
        callerNumber,
      });

      // STEP 1: Send ringback audio immediately (non-blocking, plays for ~8 seconds)
      const ringbackPromise = sendRingbackAudio();

      // STEP 2: Initialize NON-TTS services while ringback plays
      // (Deepgram can handle idle time, Cartesia cannot)
      twilioLogger.info('Initializing services while ringback plays', { callSid });

      // Track call start
      onCallStart();

      // Use hardcoded appointment booking prompt
      const businessName = process.env.BUSINESS_NAME || "Dr. Smith's Dental Office";
      const formattedPhone = formatPhoneForSpeech(callerNumber);

      // Get current date in readable format (e.g., "Tuesday, November 26, 2025")
      const currentDate = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      const customPrompt = `${APPOINTMENT_BOOKING_PROMPT.replace('{{CURRENT_DATE}}', currentDate)}

## Current Call Information:
- Business Name: ${businessName}
- Caller's Phone Number: ${formattedPhone}

When confirming the phone number, use this exact pattern:
1. Say "Is ${formattedPhone}..."
2. PAUSE for half a second (add ellipsis or comma for natural pause)
3. Then continue: "...the best number to reach you?"

This gives the caller time to process the number. Example: "Is (555) 123-4567... the best number to reach you?"`;

      twilioLogger.info('Using appointment booking prompt', {
        callSid,
        businessName,
        callerPhone: callerNumber,
      });

      // Initialize system message
      messages.push({
        role: 'system',
        content: customPrompt,
      });

      // Initialize Deepgram and LLM router (can be idle without issues)
      deepgram = new DeepgramService();
      llmRouter = new LLMRouter();

      // Start Deepgram stream (STT) - can start listening early
      deepgramConnection = await deepgram.startStream(
        onTranscript,
        onDeepgramError
      );

      const preRingbackEndTime = Date.now();
      const preRingbackDuration = preRingbackEndTime - initStartTime;

      twilioLogger.info('Non-TTS services initialized', {
        callSid,
        sttProvider: 'Deepgram',
        duration: `${preRingbackDuration}ms`,
      });

      // STEP 3: Wait for ringback to finish
      await ringbackPromise;

      twilioLogger.info('Ringback complete, NOW connecting Cartesia (fresh connection)', {
        callSid,
        ringbackDuration: `${Date.now() - initStartTime}ms`,
      });

      // STEP 4: Connect to Cartesia WebSocket NOW (fresh connection, used immediately)
      // v2.x: No delay needed - lazy connection works on first send()
      // Use default voice or voice from environment variable
      const voiceId = process.env.AI_VOICE_ID || null;
      cartesia = new CartesiaService();
      cartesiaConnection = await cartesia.connect(voiceId);

      const cartesiaConnectedTime = Date.now();
      twilioLogger.info('Cartesia connected and ready (v2.x)', {
        callSid,
        ttsProvider: 'Cartesia WebSocket v2.x',
        ttsVoiceId: voiceId || 'default',
        connectionTime: `${cartesiaConnectedTime - preRingbackEndTime}ms`,
        totalInitTime: `${cartesiaConnectedTime - initStartTime}ms`,
      });

      // STEP 5: Immediately send greeting (no idle time!)
      const greeting = getInitialGreeting();
      await sendAIResponse(greeting);

      twilioLogger.info('✅ Call initialization complete', {
        callSid,
        totalTime: `${Date.now() - initStartTime}ms`,
      });
    } catch (error) {
      twilioLogger.error('Failed to initialize call', error);
      ws.close();
    }
  }

  /**
   * Strip function call syntax from LLM response
   * Removes <function=...>...</function> tags that should not be spoken
   */
  function stripFunctionCalls(text) {
    // Remove function call syntax: <function=name>{...}</function>
    return text.replace(/<function=[^>]+>.*?<\/function>/g, '').trim();
  }

  /**
   * Handle transcript from Deepgram
   */
  async function onTranscript(transcriptText) {
    const transcriptReceivedAt = Date.now();

    try {
      // LOG TRANSCRIPT ENTRY (VERBOSE)
      twilioLogger.info('📞 USER TRANSCRIPT', {
        callSid,
        speaker: 'user',
        text: transcriptText,
        textLength: transcriptText.length,
        timestamp: new Date().toISOString(),
        turnNumber: Math.floor(transcript.length / 2) + 1,
      });

      // Add to transcript
      const transcriptEntry = {
        speaker: 'user',
        text: transcriptText,
        timestamp: new Date().toISOString(),
      };
      transcript.push(transcriptEntry);

      // Add to conversation history
      messages.push({
        role: 'user',
        content: transcriptText,
      });

      // Get LLM response with timing
      // All calls use appointment booking tools
      const llmStartTime = Date.now();
      const response = await llmRouter.chat(messages, callSid, APPOINTMENT_TOOLS);
      const llmEndTime = Date.now();

      llmCalls++;
      totalLatency += response.latency;
      totalCost += response.cost;
      primaryProvider = response.provider;

      // LOG RAW LLM RESPONSE
      twilioLogger.debug('🤖 LLM RAW RESPONSE', {
        callSid,
        provider: response.provider,
        hasContent: !!response.content,
        hasToolCalls: !!(response.toolCalls && response.toolCalls.length > 0),
        toolCallCount: response.toolCalls?.length || 0,
        contentLength: response.content?.length || 0,
        rawContent: response.content || '(no content)',
        tokens: response.tokens,
        latency: `${response.latency}ms`,
        cost: `$${response.cost.toFixed(6)}`,
      });

      // TWO-STAGE RESPONSE PATTERN
      // Check for tool calls FIRST - execute silently, then get natural response
      if (response.toolCalls && response.toolCalls.length > 0) {
        twilioLogger.info('🔧 TOOL CALLS DETECTED', {
          callSid,
          toolCount: response.toolCalls.length,
          tools: response.toolCalls.map(tc => tc.function.name),
        });

        // Add assistant's tool call message to history
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: response.toolCalls,
        });

        // Execute each tool SILENTLY and collect results
        for (const toolCall of response.toolCalls) {
          const result = await executeToolCall(toolCall);

          // Add tool result to conversation history
          messages.push({
            tool_call_id: toolCall.id,
            role: 'tool',
            name: toolCall.function.name,
            content: JSON.stringify(result),
          });

          twilioLogger.debug('🔧 TOOL EXECUTED', {
            callSid,
            toolName: toolCall.function.name,
            toolCallId: toolCall.id,
            result,
          });
        }

        // SECOND API CALL - Get natural language response after tool execution
        const followUpStartTime = Date.now();
        const finalResponse = await llmRouter.chatWithToolResults(messages, callSid);
        const followUpEndTime = Date.now();

        // Track additional metrics
        llmCalls++;
        totalLatency += finalResponse.latency;
        totalCost += finalResponse.cost;

        twilioLogger.debug('🤖 FOLLOW-UP RESPONSE (after tools)', {
          callSid,
          hasContent: !!finalResponse.content,
          contentLength: finalResponse.content?.length || 0,
          latency: `${finalResponse.latency}ms`,
        });

        // Send the natural language response to TTS
        if (finalResponse.content) {
          // Safety sanitization - strip any leaked syntax
          const cleanContent = stripFunctionCalls(finalResponse.content);

          messages.push({
            role: 'assistant',
            content: cleanContent,
          });

          // LOG AI RESPONSE BEFORE TTS
          twilioLogger.info('🤖 AI TRANSCRIPT', {
            callSid,
            speaker: 'ai',
            text: cleanContent,
            textLength: cleanContent.length,
            timestamp: new Date().toISOString(),
            turnNumber: Math.floor(transcript.length / 2) + 1,
          });

          const ttsStartTime = Date.now();
          await sendAIResponse(cleanContent);
          const ttsEndTime = Date.now();

          // Log detailed latency breakdown
          twilioLogger.info('⏱️ RESPONSE TIMING BREAKDOWN (two-stage)', {
            callSid,
            firstLlmLatency: `${llmEndTime - llmStartTime}ms`,
            secondLlmLatency: `${followUpEndTime - followUpStartTime}ms`,
            ttsLatency: `${ttsEndTime - ttsStartTime}ms`,
            totalPipelineLatency: `${ttsEndTime - transcriptReceivedAt}ms`,
            responseLength: cleanContent.length,
            toolsExecuted: response.toolCalls.length,
            provider: response.provider,
          });
        }
      } else if (response.content) {
        // No tool calls - just a regular text response
        // Safety sanitization as fallback
        const cleanContent = stripFunctionCalls(response.content);

        if (cleanContent.length > 0) {
          messages.push({
            role: 'assistant',
            content: cleanContent,
          });

          // LOG AI RESPONSE BEFORE TTS
          twilioLogger.info('🤖 AI TRANSCRIPT', {
            callSid,
            speaker: 'ai',
            text: cleanContent,
            textLength: cleanContent.length,
            timestamp: new Date().toISOString(),
            turnNumber: Math.floor(transcript.length / 2) + 1,
          });

          const ttsStartTime = Date.now();
          await sendAIResponse(cleanContent);
          const ttsEndTime = Date.now();

          // Log detailed latency breakdown
          twilioLogger.info('⏱️ RESPONSE TIMING BREAKDOWN', {
            callSid,
            llmLatency: `${llmEndTime - llmStartTime}ms`,
            ttsLatency: `${ttsEndTime - ttsStartTime}ms`,
            totalPipelineLatency: `${ttsEndTime - transcriptReceivedAt}ms`,
            responseLength: cleanContent.length,
            provider: response.provider,
          });
        }
      }
    } catch (error) {
      twilioLogger.error('Error processing transcript', error);

      // Provide user feedback on error instead of silence
      try {
        const errorResponse = "Sorry, I didn't catch that. Could you repeat what you said?";
        messages.push({
          role: 'assistant',
          content: errorResponse,
        });
        await sendAIResponse(errorResponse);
      } catch (ttsError) {
        twilioLogger.error('Failed to send error response', ttsError);
      }
    }
  }

  /**
   * Execute a tool call and return the result
   * @param {Object} toolCall - Tool call object from LLM
   * @returns {Object} Result of tool execution
   */
  async function executeToolCall(toolCall) {
    const functionName = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments);

    twilioLogger.info('Executing appointment tool', {
      tool: functionName,
      toolCallId: toolCall.id,
      args
    });

    try {
      if (functionName === 'set_caller_timezone') {
        // Parse caller's local time and calculate timezone offset
        const { localTime } = args;

        twilioLogger.info('Setting caller timezone', { localTime });

        // Parse the time string (handles formats like "4:30 PM", "16:30", "4:30pm", "afternoon")
        const lowerTime = localTime.toLowerCase();

        // Check if they just said "morning", "afternoon", "evening" without a time
        if (!lowerTime.match(/\d/) && (lowerTime.includes('morning') || lowerTime.includes('afternoon') || lowerTime.includes('evening'))) {
          return {
            success: false,
            message: 'Need specific time. Please tell me the exact hour.'
          };
        }

        const timeMatch = localTime.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/i);
        if (!timeMatch) {
          return {
            success: false,
            message: 'Could not parse time. Please try again.'
          };
        }

        let hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2] || '0');
        const meridiem = timeMatch[3]?.toLowerCase().replace(/\./g, ''); // Remove periods from a.m./p.m.
        const isPM = meridiem === 'pm';
        const isAM = meridiem === 'am';

        // If no AM/PM specified and hour is ambiguous (1-12), return error
        if (!isPM && !isAM && hours >= 1 && hours <= 12) {
          return {
            success: false,
            message: 'Need to know if AM or PM. Is that morning or afternoon?'
          };
        }

        // Convert to 24-hour format
        if (isPM && hours !== 12) hours += 12;
        if (isAM && hours === 12) hours = 0;
        // If they said 13-23, assume 24-hour format (no conversion needed)

        // Get current server time
        const serverTime = new Date();
        const serverHours = serverTime.getUTCHours();
        const serverMinutes = serverTime.getUTCMinutes();

        // Calculate caller's time in minutes since midnight
        const callerMinutes = hours * 60 + minutes;

        // Calculate server time in minutes since midnight
        const serverMinutesTotal = serverHours * 60 + serverMinutes;

        // Calculate offset in hours (caller time - server time)
        let offsetMinutes = callerMinutes - serverMinutesTotal;

        // Handle day boundary crossings
        if (offsetMinutes > 12 * 60) offsetMinutes -= 24 * 60;
        if (offsetMinutes < -12 * 60) offsetMinutes += 24 * 60;

        const offsetHours = Math.round(offsetMinutes / 60);

        // Store in appointment data
        appointmentData.timezoneOffset = offsetHours;
        appointmentData.callerLocalTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

        twilioLogger.info('Timezone calculated', {
          callerLocalTime: appointmentData.callerLocalTime,
          timezoneOffset: offsetHours,
          serverUTC: `${serverHours}:${serverMinutes}`
        });

        return {
          success: true,
          timezoneOffset: offsetHours,
          message: 'Timezone set successfully'
        };

      } else if (functionName === 'check_availability') {
        // Check if a specific time slot is available
        const { date, time, duration = 30 } = args;

        // Combine date and time into full timestamp
        const appointmentTime = new Date(`${date}T${time}`);

        const isAvailable = await checkAvailability(appointmentTime, duration);

        twilioLogger.info('Availability check completed', {
          date,
          time,
          duration,
          isAvailable
        });

        return {
          success: true,
          available: isAvailable,
          date,
          time,
          message: isAvailable
            ? `Yes, ${time} on ${date} is available.`
            : `Sorry, ${time} on ${date} is not available.`
        };

      } else if (functionName === 'get_available_slots') {
        // Get all available slots for a date
        const { date, duration = 30 } = args;

        // Get timezone offset (default to -8 for PST if not set)
        const timezoneOffset = appointmentData.timezoneOffset || -8;

        // Create date in caller's timezone
        const dateObj = new Date(`${date}T00:00:00`);
        const slots = await getAvailableSlots(dateObj, duration);

        // Get caller's current time
        const serverNow = new Date();
        const callerNow = new Date(serverNow.getTime() + (timezoneOffset * 60 * 60 * 1000));

        twilioLogger.info('Available slots retrieved', {
          date,
          duration,
          slotsFound: slots.length,
          timezoneOffset,
          callerCurrentTime: callerNow.toISOString()
        });

        // Filter out past times (only for today's date)
        let filteredSlots = slots;
        const requestedDate = new Date(date);
        const callerToday = new Date(callerNow.getFullYear(), callerNow.getMonth(), callerNow.getDate());

        if (requestedDate.getTime() === callerToday.getTime()) {
          // It's today - filter out times that have already passed
          // Add 2-hour buffer so they can't book something starting in 30 minutes
          const minTime = new Date(callerNow.getTime() + (2 * 60 * 60 * 1000));

          filteredSlots = slots.filter(slot => {
            return slot.startTime.getTime() > minTime.getTime();
          });

          twilioLogger.info('Filtered past times for today', {
            originalCount: slots.length,
            filteredCount: filteredSlots.length,
            callerNow: callerNow.toISOString(),
            minTime: minTime.toISOString()
          });
        }

        // Format slots for LLM
        const formattedSlots = filteredSlots.map(slot => {
          const timeStr = slot.startTime.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });
          return timeStr;
        });

        return {
          success: true,
          date,
          slots: formattedSlots,
          count: formattedSlots.length,
          message: formattedSlots.length > 0
            ? `Available times on ${date}: ${formattedSlots.join(', ')}`
            : `No available slots on ${date}`
        };

      } else if (functionName === 'create_appointment') {
        // Create appointment on calendar and in database
        const { callerName, callerPhone, date, time, reason, duration = 30 } = args;

        // Combine date and time
        const appointmentTime = new Date(`${date}T${time}`);

        twilioLogger.info('Creating appointment', {
          callerName,
          callerPhone,
          appointmentTime: appointmentTime.toISOString(),
          reason,
          duration
        });

        // Create calendar event
        const calendarEvent = await createCalendarAppointment({
          callerName,
          callerPhone,
          appointmentTime,
          reason,
          durationMinutes: duration
        });

        // Save to database
        const dbAppointment = await createDbAppointment({
          callerName,
          callerPhone,
          appointmentTime: appointmentTime.toISOString(),
          reason,
          googleCalendarEventId: calendarEvent.id,
          status: 'confirmed'
        });

        // Send SMS confirmation
        try {
          await sendAppointmentConfirmation({
            callerName,
            callerPhone,
            appointmentTime: appointmentTime.toISOString(),
            reason
          });
          twilioLogger.info('SMS confirmation sent', { appointmentId: dbAppointment.id });
        } catch (smsError) {
          twilioLogger.error('Failed to send SMS confirmation', smsError);
          // Don't fail the appointment creation if SMS fails
        }

        // Update appointment data
        appointmentData.callerName = callerName;
        appointmentData.callerPhone = callerPhone;
        appointmentData.appointmentBooked = true;
        appointmentData.appointmentId = dbAppointment.id;
        appointmentData.googleCalendarEventId = calendarEvent.id;

        twilioLogger.info('Appointment created successfully', {
          appointmentId: dbAppointment.id,
          calendarEventId: calendarEvent.id
        });

        return {
          success: true,
          appointmentId: dbAppointment.id,
          appointmentTime: appointmentTime.toISOString(),
          message: `Appointment confirmed for ${callerName} on ${date} at ${time}`
        };

      } else if (functionName === 'update_appointment_info') {
        // Silently update collected appointment data
        Object.assign(appointmentData, args);
        twilioLogger.debug('Appointment info updated', appointmentData);
        return { success: true, updated: Object.keys(args) };

      } else if (functionName === 'end_call_with_confirmation') {
        // Call is ending
        twilioLogger.info('Call ending', {
          summary: args.summary,
          appointmentBooked: args.appointmentBooked
        });

        appointmentData.appointmentBooked = args.appointmentBooked;

        // Schedule call close after TTS completes
        setTimeout(() => {
          ws.close();
        }, 5000); // Give time for final message to play

        return {
          success: true,
          callEnding: true,
          summary: args.summary,
          appointmentBooked: args.appointmentBooked
        };
      }

      return { success: false, error: 'Unknown tool' };

    } catch (error) {
      twilioLogger.error('Tool execution failed', error, {
        tool: functionName,
        args
      });

      // Return helpful error messages for specific failures
      let errorMessage;
      if (functionName === 'get_available_slots') {
        errorMessage = `I'm having trouble accessing the calendar right now. Could you suggest a few dates and times that work for you?`;
      } else if (functionName === 'check_availability') {
        errorMessage = `I'm unable to check availability at the moment. Let me note down your preferred time and we'll confirm it shortly.`;
      } else if (functionName === 'create_appointment') {
        errorMessage = `There was an issue creating the appointment. Let me take your information and someone will call you back to confirm.`;
      } else {
        errorMessage = `I encountered an error with ${functionName.replace(/_/g, ' ')}. Let's try a different approach.`;
      }

      return {
        success: false,
        error: error.message,
        message: errorMessage
      };
    }
  }

  /**
   * Send AI response via TTS (WebSocket streaming with automatic retry)
   * v2.x: Includes idle connection refresh check
   */
  async function sendAIResponse(text) {
    try {
      // Check if connection needs refresh (5-min idle timeout)
      if (cartesia.needsRefresh()) {
        twilioLogger.warn('Refreshing Cartesia before 5-min idle timeout', {
          callSid,
        });
        await cartesia.disconnect();
        const voiceId = process.env.AI_VOICE_ID || null;
        await cartesia.connect(voiceId);
      }

      // LOG TTS REQUEST
      const voiceId = process.env.AI_VOICE_ID || 'default';
      twilioLogger.debug('🔊 TTS STREAMING REQUEST (v2.x)', {
        callSid,
        text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        textLength: text.length,
        voiceId,
        method: 'websocket-streaming-with-retry-v2',
      });

      // Add to transcript
      transcript.push({
        speaker: 'ai',
        text,
        timestamp: new Date().toISOString(),
      });

      // Queue TTS request to prevent concurrent connections hitting rate limits
      // v2.x: audioChunk is already a Buffer from cartesia.js
      await cartesia.queueSpeakText(text, (audioChunk) => {
        // Convert Buffer to Base64 for Twilio
        const base64Audio = audioChunk.toString('base64');
        ws.send(
          JSON.stringify({
            event: 'media',
            streamSid: streamSid,
            media: {
              payload: base64Audio,
            },
          })
        );
      });
    } catch (error) {
      twilioLogger.error('Error in sendAIResponse', error);
      throw error;
    }
  }

  /**
   * Handle Deepgram errors
   */
  function onDeepgramError(error) {
    twilioLogger.error('Deepgram error', error);
  }

  /**
   * Save call log to database
   */
  async function finalize() {
    try {
      endTime = new Date().toISOString();
      const duration = Math.floor(
        (new Date(endTime) - new Date(startTime)) / 1000
      );

      // LOG FULL CALL TRANSCRIPT (VERBOSE)
      twilioLogger.info('📋 FULL CALL TRANSCRIPT', {
        callSid,
        fromNumber,
        toNumber,
        duration: `${duration}s`,
        turns: transcript.length,
        transcript: transcript.map((entry, idx) => ({
          turn: idx + 1,
          speaker: entry.speaker,
          text: entry.text,
          timestamp: entry.timestamp,
        })),
      });

      // LOG CALL SUMMARY STATS
      twilioLogger.info('📊 CALL SUMMARY STATS', {
        callSid,
        duration: `${duration}s`,
        totalTurns: transcript.length,
        userTurns: transcript.filter((t) => t.speaker === 'user').length,
        aiTurns: transcript.filter((t) => t.speaker === 'ai').length,
        llmCalls,
        avgLlmLatency: llmCalls > 0 ? Math.round(totalLatency / llmCalls) : 0,
        totalCost: `$${totalCost.toFixed(4)}`,
        provider: primaryProvider,
        appointmentData: JSON.stringify(appointmentData, null, 2),
      });

      // Build full transcript text
      const transcriptText = transcript
        .map(entry => `[${entry.speaker}]: ${entry.text}`)
        .join('\n');

      // Save call log to database
      twilioLogger.info('Saving call log to database', { callSid });

      await createCallLog({
        twilioCallSid: callSid,
        callerPhone: fromNumber,
        callStartedAt: startTime,
        callEndedAt: endTime,
        durationSeconds: duration,
        transcript: transcriptText,
        appointmentBooked: appointmentData.appointmentBooked,
        appointmentId: appointmentData.appointmentId
      });

      // Track call end
      onCallEnd();

      twilioLogger.info('✅ Call completed successfully', {
        callSid,
        duration,
        llmCalls,
        avgLatency: llmCalls > 0 ? Math.round(totalLatency / llmCalls) : 0,
        cost: totalCost.toFixed(4),
        appointmentBooked: appointmentData.appointmentBooked
      });
    } catch (error) {
      twilioLogger.error('Error finalizing call', error);
    }
  }

  // Handle WebSocket messages from Twilio
  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.event === 'start') {
        callSid = msg.start.callSid;
        streamSid = msg.start.streamSid;

        // Extract phone numbers from custom parameters (sent via Stream TwiML)
        fromNumber = msg.start.customParameters?.From;
        toNumber = msg.start.customParameters?.To;

        startTime = new Date().toISOString();

        twilioLogger.info('Call started', {
          callSid,
          from: fromNumber,
          to: toNumber,
          customParameters: msg.start.customParameters,
        });

        await initialize(toNumber, fromNumber);
      } else if (msg.event === 'media') {
        // Forward audio to Deepgram
        if (deepgramConnection && msg.media?.payload) {
          const audioBuffer = Buffer.from(msg.media.payload, 'base64');
          deepgram.sendAudio(deepgramConnection, audioBuffer);
        }
      } else if (msg.event === 'stop') {
        twilioLogger.info('Call stopped', { callSid });

        // Close Deepgram
        if (deepgramConnection) {
          deepgram.closeStream(deepgramConnection);
        }

        // Close Cartesia WebSocket
        if (cartesia) {
          await cartesia.disconnect();
        }

        // Finalize call
        await finalize();
      }
    } catch (error) {
      twilioLogger.error('Error handling Twilio message', error);
    }
  });

  ws.on('error', (error) => {
    twilioLogger.error('WebSocket error', error);
  });

  ws.on('close', () => {
    twilioLogger.info('WebSocket closed', { callSid });

    // Clean up
    if (deepgramConnection) {
      deepgram.closeStream(deepgramConnection);
    }

    if (cartesia) {
      cartesia.disconnect();
    }
  });
}

export default {
  handleTwilioStream,
};
