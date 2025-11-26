# Fly Appointment Agent

> Standalone AI voice agent with appointment booking - custom voice AI platform with Google Calendar integration

**Status:** 🔴 Under Development

**Original Project:** [fly-voice-agent](https://github.com/cameronobriendev/fly-voice-agent) (voice conversations only)

**This Version:** Adds appointment booking functionality with Google Calendar API integration, SMS confirmations, and booking management. **No multi-tenant complexity** - clean, standalone demo.

---

## What This Is

A production-ready voice AI appointment booking system that handles phone calls, has natural conversations, checks calendar availability, books appointments, and sends SMS confirmations.

**Built from scratch** - custom voice AI stack (not Bland.ai, not Vapi):
- Deepgram (speech-to-text)
- Groq/Gemini (LLM reasoning)
- Cartesia (text-to-speech)
- Twilio (phone + SMS)
- Google Calendar API (scheduling)
- Fly.io (serverless deployment)

---

## Features

### Core Voice AI
- **Real-Time Voice Conversations** - Low-latency AI phone conversations
- **Speech-to-Text** - Deepgram real-time transcription
- **AI Reasoning** - Groq (fast) with Gemini fallback
- **Text-to-Speech** - Cartesia ultra-low latency voice synthesis
- **WebSocket Streaming** - Real-time bidirectional audio
- **Auto-Scaling** - Fly.io machines scale 0→1 on demand

### Appointment Booking
- **Google Calendar Integration** - Check availability, book appointments
- **Natural Conversation Booking** - No rigid menu trees, just talk
- **SMS Confirmations** - Twilio SMS sent after booking
- **Conflict Detection** - Prevents double-bookings
- **Business Hours Logic** - Only books within configured hours
- **Database Storage** - PostgreSQL appointment records
- **Call Logging** - Track all calls and outcomes

---

## Tech Stack

**Voice AI:**
- Node.js + Express (web server)
- WebSockets (real-time audio streaming)
- Deepgram SDK (speech-to-text)
- Groq SDK (fast LLM inference)
- Google Gemini (LLM backup)
- Cartesia (text-to-speech)

**Appointment Booking:**
- Google Calendar API (scheduling)
- Twilio (phone numbers + SMS)
- Neon PostgreSQL (appointment database)
- Fly.io (serverless deployment)

---

## Database Schema

**Simple, standalone schema** (no multi-tenant complexity):

```sql
-- Appointments table
CREATE TABLE appointments (
  id UUID PRIMARY KEY,
  caller_name VARCHAR(255),
  caller_phone VARCHAR(20),
  appointment_time TIMESTAMP,
  reason TEXT,
  google_calendar_event_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'confirmed',
  sms_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Call logs table
CREATE TABLE call_logs (
  id UUID PRIMARY KEY,
  twilio_call_sid VARCHAR(255) UNIQUE,
  caller_phone VARCHAR(20),
  call_started_at TIMESTAMP,
  duration_seconds INTEGER,
  transcript TEXT,
  appointment_booked BOOLEAN DEFAULT FALSE,
  appointment_id UUID REFERENCES appointments(id)
);
```

**Run setup:**
```bash
psql $DATABASE_URL < db-schema.sql
```

---

## Environment Variables

See `.env.example` for complete configuration:

### Required for Voice AI
- `DEEPGRAM_API_KEY` - Speech-to-text
- `GROQ_API_KEY` - LLM (primary)
- `GOOGLE_API_KEY` - Gemini LLM (fallback)
- `CARTESIA_API_KEY` - Text-to-speech

### Required for Appointment Booking
- `GOOGLE_CALENDAR_ID` - Calendar to book into (e.g., "primary")
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` - Service account email
- `GOOGLE_SERVICE_ACCOUNT_KEY` - Base64-encoded JSON key
- `TWILIO_ACCOUNT_SID` - Twilio account
- `TWILIO_AUTH_TOKEN` - Twilio auth token
- `TWILIO_PHONE_NUMBER` - Phone number for SMS

### Required for Database
- `DATABASE_URL` - PostgreSQL connection string (Neon or Vercel Postgres)

### Business Configuration (Hardcoded)
- `BUSINESS_NAME` - Display name (e.g., "Dr. Smith's Dental Office")
- `BUSINESS_TIMEZONE` - Timezone (e.g., "America/Los_Angeles")
- `BUSINESS_HOURS_START` - Open time (e.g., "09:00")
- `BUSINESS_HOURS_END` - Close time (e.g., "17:00")

---

## Local Development

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Fill in all API keys and credentials

# Run database setup
psql $DATABASE_URL < db-schema.sql

# Start development server
npm run dev
```

Server runs on http://localhost:8080

---

## Google Calendar API Setup

### 1. Create Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project or select existing
3. Enable Google Calendar API
4. Create Service Account:
   - IAM & Admin → Service Accounts → Create
   - Name: "appointment-booking-agent"
   - Role: None needed (calendar permissions granted separately)
5. Create JSON key:
   - Keys → Add Key → Create New Key → JSON
   - Download JSON file

### 2. Share Calendar

1. Open Google Calendar
2. Settings → Your calendar → Share with specific people
3. Add service account email (from JSON file)
4. Permissions: "Make changes to events"

### 3. Encode Key for Environment Variable

```bash
# Base64 encode the JSON key file
cat service-account-key.json | base64
# Copy output to GOOGLE_SERVICE_ACCOUNT_KEY in .env
```

---

## Deployment to Fly.io

### 1. Initial Setup

```bash
# Fly.io app already created: fly-appointment-agent
# Verify:
fly apps list | grep appointment

# Set secrets (DO NOT put in fly.toml)
fly secrets set DATABASE_URL="postgresql://..."
fly secrets set DEEPGRAM_API_KEY="..."
fly secrets set GROQ_API_KEY="..."
fly secrets set GOOGLE_API_KEY="..."
fly secrets set CARTESIA_API_KEY="..."
fly secrets set GOOGLE_CALENDAR_ID="primary"
fly secrets set GOOGLE_SERVICE_ACCOUNT_EMAIL="your-sa@project.iam.gserviceaccount.com"
fly secrets set GOOGLE_SERVICE_ACCOUNT_KEY="base64-encoded-json-key"
fly secrets set TWILIO_ACCOUNT_SID="..."
fly secrets set TWILIO_AUTH_TOKEN="..."
fly secrets set TWILIO_PHONE_NUMBER="+15551234567"
fly secrets set FLY_STREAM_URL="wss://fly-appointment-agent.fly.dev/stream"
fly secrets set BUSINESS_NAME="Dr. Smith's Dental Office"
fly secrets set BUSINESS_TIMEZONE="America/Los_Angeles"
fly secrets set BUSINESS_HOURS_START="09:00"
fly secrets set BUSINESS_HOURS_END="17:00"
```

### 2. Deploy

```bash
# Deploy application
fly deploy

# View logs
fly logs

# Check status
fly status

# Scale machines (or use auto-scaling)
fly scale count 1
```

### 3. Configure Twilio

Point your Twilio phone number webhook to:
```
https://fly-appointment-agent.fly.dev/api/twilio/router
```

---

## Differences from Original fly-voice-agent

| Feature | fly-voice-agent (original) | fly-appointment-agent (this) |
|---------|---------------------------|----------------------------|
| **Purpose** | General voice conversations | Appointment booking |
| **Architecture** | Multi-tenant (LeadSaveAI integration) | Standalone (single business) |
| **Database** | users + business_config tables | appointments + call_logs tables |
| **Prompts** | Dynamic (fetched from database) | Hardcoded appointment booking prompt |
| **Calendar** | None | Google Calendar API integration |
| **SMS** | None | Twilio SMS confirmations |
| **Deployment** | fly-voice-agent-red-darkness-2650 | fly-appointment-agent |
| **Complexity** | High (supports multiple businesses) | Low (demo for portfolio) |

**Why Standalone?**
- Portfolio demo (no multi-tenant complexity)
- Easier to deploy and test
- Focused on appointment booking capability
- No LeadSaveAI database dependencies

---

## API Endpoints

### Voice
- `POST /api/twilio/router` - Twilio webhook (incoming calls)
- `POST /voice/stream` - WebSocket endpoint for voice streaming

### Appointments (Coming Soon)
- `GET /api/appointments` - List upcoming appointments
- `POST /api/appointments` - Create appointment manually
- `DELETE /api/appointments/:id` - Cancel appointment

### Health
- `GET /health` - Health check endpoint

---

## Project Structure

```
├── src/
│   ├── api/
│   │   └── twilio/router.js         # Twilio call webhook handler
│   ├── db/
│   │   ├── neon.js                  # Database client
│   │   └── queries.js               # Database queries (simplified)
│   ├── prompts/
│   │   └── appointment-booking.js   # Standalone booking prompt
│   ├── services/
│   │   ├── deepgram.js              # Speech-to-text
│   │   ├── groq-client.js           # Groq LLM
│   │   ├── gemini-client.js         # Gemini LLM
│   │   ├── cartesia.js              # Text-to-speech
│   │   ├── google-calendar.js       # Calendar API (NEW)
│   │   └── sms.js                   # Twilio SMS (NEW)
│   └── server.js                    # Express server
├── db-schema.sql                    # Clean database schema
├── fly.toml                         # Fly.io config
└── package.json                     # Dependencies
```

---

## How It Works

### Call Flow

1. **Incoming Call**
   - Caller dials Twilio number
   - Twilio webhook hits `/api/twilio/router`
   - WebSocket connection established

2. **Voice AI Conversation**
   - Audio streams to Deepgram (speech-to-text)
   - Transcript sent to Groq/Gemini (AI reasoning)
   - AI response sent to Cartesia (text-to-speech)
   - Audio streams back to caller

3. **Appointment Booking**
   - AI collects: name, phone, date/time preference, reason
   - Checks Google Calendar for availability
   - If available: creates calendar event
   - If conflict: suggests alternatives

4. **Confirmation**
   - Saves appointment to PostgreSQL database
   - Sends SMS confirmation via Twilio
   - Logs call details

---

## Next Steps (Under Development)

- [ ] Implement Google Calendar API service
- [ ] Implement Twilio SMS service
- [ ] Update conversation handler to use calendar tool
- [ ] Add appointment management endpoints
- [ ] Add rescheduling logic
- [ ] Add cancellation via SMS ("Reply CANCEL")
- [ ] Deploy to Fly.io and test end-to-end
- [ ] Create demo video for portfolio

---

## Costs

**Fly.io (Auto-Scaling):**
- Idle: $0/month (0 machines running)
- Active: ~$0.02/hour per machine (1GB RAM)

**Voice AI APIs (Per Call):**
- Deepgram: ~$0.0043/minute
- Groq: Free tier available
- Gemini: Pay-per-use
- Cartesia: ~$0.05/1K characters

**Google Calendar API:**
- Free (up to 1,000,000 requests/day)

**Twilio:**
- Phone number: ~$1/month
- Voice: ~$0.0130/minute
- SMS: ~$0.0075/message

---

## License

MIT

---

## Credits

Built by [Cameron O'Brien](https://github.com/cameronobriendev)

Based on [fly-voice-agent](https://github.com/cameronobriendev/fly-voice-agent) - custom voice AI platform

**Portfolio piece** - demonstrates custom voice AI implementation + appointment booking integration
