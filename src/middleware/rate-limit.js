/**
 * Rate limiting middleware
 * Prevents abuse of demo call endpoint using in-memory tracking
 */

import { logger } from '../utils/logger.js';

const rateLimitLogger = logger.child('RATE_LIMIT');

// In-memory stores
const ipCallCounts = new Map(); // IP -> { count, resetTime }
const phoneCallCounts = new Map(); // Phone -> { count, resetTime }

// Configuration
const RATE_LIMITS = {
  IP_MAX_CALLS: 3,          // Max calls per IP
  IP_WINDOW_MS: 60 * 60 * 1000, // 1 hour
  PHONE_MAX_CALLS: 1,        // Max calls to same phone
  PHONE_WINDOW_MS: 5 * 60 * 1000, // 5 minutes
};

/**
 * Clean up expired entries (runs periodically)
 */
function cleanupExpired() {
  const now = Date.now();

  // Clean IP records
  for (const [ip, data] of ipCallCounts.entries()) {
    if (now >= data.resetTime) {
      ipCallCounts.delete(ip);
    }
  }

  // Clean phone records
  for (const [phone, data] of phoneCallCounts.entries()) {
    if (now >= data.resetTime) {
      phoneCallCounts.delete(phone);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpired, 5 * 60 * 1000);

/**
 * Get client IP address from request
 */
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.ip
    || req.connection.remoteAddress;
}

/**
 * Rate limit middleware for demo calls
 */
export function rateLimitDemoCalls(req, res, next) {
  const clientIP = getClientIP(req);
  const phoneNumber = req.body.phoneNumber?.replace(/[\s\-\(\)]/g, '');
  const now = Date.now();

  // Check IP rate limit
  const ipRecord = ipCallCounts.get(clientIP);
  if (ipRecord) {
    if (now < ipRecord.resetTime) {
      if (ipRecord.count >= RATE_LIMITS.IP_MAX_CALLS) {
        const minutesLeft = Math.ceil((ipRecord.resetTime - now) / 60000);

        rateLimitLogger.warn('IP rate limit exceeded', {
          ip: clientIP,
          count: ipRecord.count,
          minutesLeft
        });

        return res.status(429).json({
          error: `Rate limit exceeded. You can make ${RATE_LIMITS.IP_MAX_CALLS} demo calls per hour. Please try again in ${minutesLeft} minutes.`,
          retryAfter: minutesLeft * 60
        });
      }
      ipRecord.count++;
    } else {
      // Reset expired window
      ipRecord.count = 1;
      ipRecord.resetTime = now + RATE_LIMITS.IP_WINDOW_MS;
    }
  } else {
    // First call from this IP
    ipCallCounts.set(clientIP, {
      count: 1,
      resetTime: now + RATE_LIMITS.IP_WINDOW_MS
    });
  }

  // Check phone number rate limit (prevent spamming same number)
  if (phoneNumber) {
    const phoneRecord = phoneCallCounts.get(phoneNumber);
    if (phoneRecord) {
      if (now < phoneRecord.resetTime) {
        if (phoneRecord.count >= RATE_LIMITS.PHONE_MAX_CALLS) {
          const minutesLeft = Math.ceil((phoneRecord.resetTime - now) / 60000);

          rateLimitLogger.warn('Phone number rate limit exceeded', {
            phone: phoneNumber,
            count: phoneRecord.count,
            minutesLeft
          });

          return res.status(429).json({
            error: `This phone number was recently called. Please wait ${minutesLeft} minutes before requesting another demo call.`,
            retryAfter: minutesLeft * 60
          });
        }
        phoneRecord.count++;
      } else {
        // Reset expired window
        phoneRecord.count = 1;
        phoneRecord.resetTime = now + RATE_LIMITS.PHONE_WINDOW_MS;
      }
    } else {
      // First call to this number
      phoneCallCounts.set(phoneNumber, {
        count: 1,
        resetTime: now + RATE_LIMITS.PHONE_WINDOW_MS
      });
    }
  }

  rateLimitLogger.debug('Rate limit check passed', {
    ip: clientIP,
    phone: phoneNumber,
    ipCount: ipCallCounts.get(clientIP)?.count,
    phoneCount: phoneCallCounts.get(phoneNumber)?.count
  });

  next();
}

/**
 * Get current rate limit stats (for monitoring)
 */
export function getRateLimitStats() {
  return {
    ipRecords: ipCallCounts.size,
    phoneRecords: phoneCallCounts.size,
    limits: RATE_LIMITS
  };
}

export default {
  rateLimitDemoCalls,
  getRateLimitStats
};
