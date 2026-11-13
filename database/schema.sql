-- ==============================================================================
-- AlphaChart AI - Institutional PostgreSQL Database Schema
-- Optimized for User Management, Email Marketing, PWA Sessions & Trading Records
-- Compatible with Supabase, Neon.tech, AWS RDS, Railway, and local PostgreSQL
-- ==============================================================================

-- 1. Enable UUID Extension for cryptographic unique identifiers
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- TABLE: users
-- Core subscriber table for email marketing, user analytics, and device tracking
-- ==============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(150),
    auth_provider VARCHAR(50) DEFAULT 'google',
    
    -- Marketing & Status Flags
    subscription_tier VARCHAR(50) DEFAULT 'PRO_TRIAL', -- FREE, PRO_TRIAL, VIP
    newsletter_subscribed BOOLEAN DEFAULT TRUE,
    marketing_opt_in BOOLEAN DEFAULT TRUE,
    tags TEXT[] DEFAULT ARRAY['trader', 'early_adopter', 'pwa_user'],
    
    -- Device & Session Intelligence
    pwa_installed BOOLEAN DEFAULT FALSE,
    device_platform VARCHAR(100), -- iOS, Android, Windows, macOS, Linux
    user_agent TEXT,
    ip_address VARCHAR(45),
    login_count INT DEFAULT 1,
    
    -- Timestamps
    first_login_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for lightning-fast email lookups and marketing segmentation
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_newsletter ON users(newsletter_subscribed) WHERE newsletter_subscribed = TRUE;
CREATE INDEX IF NOT EXISTS idx_users_tier ON users(subscription_tier);

-- ==============================================================================
-- TABLE: user_sessions
-- Tracks each login event, session duration, and device location
-- ==============================================================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    device_type VARCHAR(50), -- Mobile, Tablet, Desktop
    platform VARCHAR(50),    -- iOS PWA, Android Chrome, Windows Web
    ip_address VARCHAR(45),
    signed_in_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_signed_in_at ON user_sessions(signed_in_at DESC);

-- ==============================================================================
-- TABLE: trading_signals_log
-- Records all BUY/SELL signals triggered on the chart with profit outcomes
-- ==============================================================================
CREATE TABLE IF NOT EXISTS trading_signals_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pair VARCHAR(50) NOT NULL,           -- BTC/USDT, ETH/USDT, AAVE/USDT
    timeframe VARCHAR(10) NOT NULL,      -- 5m, 15m, 1h
    signal_type VARCHAR(10) NOT NULL,    -- BUY, SELL
    entry_price NUMERIC(18, 8) NOT NULL,
    tp1_price NUMERIC(18, 8),
    tp2_price NUMERIC(18, 8),
    tp3_price NUMERIC(18, 8),
    sl_price NUMERIC(18, 8),
    outcome VARCHAR(20) DEFAULT 'ACTIVE', -- TP1_HIT, TP2_HIT, TP3_HIT, SL_HIT, ACTIVE
    pnl_percent NUMERIC(8, 4),
    triggered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_signals_pair ON trading_signals_log(pair, timeframe);
CREATE INDEX IF NOT EXISTS idx_signals_triggered_at ON trading_signals_log(triggered_at DESC);

-- ==============================================================================
-- HELPER VIEW: marketing_subscribers_view
-- Instant export view ready for Mailchimp, Brevo, or ConvertKit CSV exports
-- ==============================================================================
CREATE OR REPLACE VIEW marketing_subscribers_view AS
SELECT 
    id,
    email,
    display_name,
    subscription_tier,
    login_count,
    device_platform,
    pwa_installed,
    TO_CHAR(first_login_at, 'YYYY-MM-DD HH24:MI:SS') AS signup_date,
    TO_CHAR(last_login_at, 'YYYY-MM-DD HH24:MI:SS') AS last_active_date
FROM users
WHERE newsletter_subscribed = TRUE
ORDER BY created_at DESC;

-- ==============================================================================
-- FUNCTION & TRIGGER: Auto-update updated_at timestamp on row modification
-- ==============================================================================
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_timestamp_column();

