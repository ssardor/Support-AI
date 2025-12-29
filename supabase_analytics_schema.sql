-- Analytics table for tracking assistant effectiveness
CREATE TABLE IF NOT EXISTS analytics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics(created_at DESC);

-- Event types:
-- 'message_handled' - every user message processed
-- 'contact_request' - when user asks for contact info or AI provides phone/email
-- 'booking_made' - when getAvailability is called (future: actual bookings)
