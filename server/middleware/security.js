import rateLimit from 'express-rate-limit';

export const youtubeSearchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 15,
  message: {
    error: 'Too many search requests. Please wait a minute and try again.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    error: 'Too many requests from this IP. Please try again later.'
  }
});