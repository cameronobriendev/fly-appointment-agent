/**
 * Input validation and sanitization for demo calls
 * Prevents injection attacks and validates phone numbers
 */

import { logger } from '../utils/logger.js';

const validationLogger = logger.child('VALIDATION');

// Blocked keywords in business names (prevent abuse)
const BLOCKED_KEYWORDS = [
  'nigger', 'fuck', 'shit', 'bitch', 'ass', 'porn', 'sex',
  'viagra', 'cialis', 'casino', 'lottery', 'bitcoin',
  '<script', 'javascript:', 'onerror', 'onclick'
];

// Suspicious phone number patterns
const SUSPICIOUS_PATTERNS = [
  /^(\d)\1{9,}$/,        // All same digit (e.g., 1111111111)
  /^(123456789|987654321)/, // Sequential digits
  /^(555555|000000|999999)/, // Repeated patterns
];

/**
 * Sanitize business name
 */
function sanitizeBusinessName(name) {
  if (!name || typeof name !== 'string') {
    return null;
  }

  // Trim and limit length
  let sanitized = name.trim().substring(0, 100);

  // Remove HTML tags
  sanitized = sanitized.replace(/<[^>]*>/g, '');

  // Remove special characters that could be used for injection
  sanitized = sanitized.replace(/[<>\"'`]/g, '');

  // Check for blocked keywords
  const lowerName = sanitized.toLowerCase();
  for (const keyword of BLOCKED_KEYWORDS) {
    if (lowerName.includes(keyword)) {
      validationLogger.warn('Blocked keyword detected in business name', {
        keyword,
        originalName: name
      });
      return null;
    }
  }

  // Must have at least some alphanumeric characters
  if (!/[a-zA-Z0-9]/.test(sanitized)) {
    return null;
  }

  return sanitized;
}

/**
 * Validate and normalize phone number
 */
function validatePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  // Remove all non-digit characters except +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // Must start with + for international format
  if (!cleaned.startsWith('+')) {
    // Assume US number if no country code
    if (cleaned.length === 10) {
      cleaned = '+1' + cleaned;
    } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
      cleaned = '+' + cleaned;
    } else {
      return null;
    }
  }

  // Phone numbers should be 10-15 digits (after country code)
  const digitsOnly = cleaned.replace(/\+/g, '');
  if (digitsOnly.length < 10 || digitsOnly.length > 15) {
    return null;
  }

  // Check for suspicious patterns
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(digitsOnly)) {
      validationLogger.warn('Suspicious phone number pattern detected', {
        phone: cleaned
      });
      return null;
    }
  }

  return cleaned;
}

/**
 * Validation middleware for demo call requests
 */
export function validateDemoCallInput(req, res, next) {
  const { businessName, phoneNumber } = req.body;

  // Validate business name
  const sanitizedBusinessName = sanitizeBusinessName(businessName);
  if (!sanitizedBusinessName) {
    validationLogger.warn('Invalid business name', {
      originalName: businessName,
      ip: req.ip
    });

    return res.status(400).json({
      error: 'Invalid business name. Please use alphanumeric characters only (max 100 characters).'
    });
  }

  // Validate phone number
  const validatedPhone = validatePhoneNumber(phoneNumber);
  if (!validatedPhone) {
    validationLogger.warn('Invalid phone number', {
      originalPhone: phoneNumber,
      ip: req.ip
    });

    return res.status(400).json({
      error: 'Invalid phone number. Please use international format (e.g., +1 555 123 4567).'
    });
  }

  // Replace request body with sanitized values
  req.body.businessName = sanitizedBusinessName;
  req.body.phoneNumber = validatedPhone;

  validationLogger.debug('Input validation passed', {
    businessName: sanitizedBusinessName,
    phoneNumber: validatedPhone,
    ip: req.ip
  });

  next();
}

export default {
  validateDemoCallInput
};
