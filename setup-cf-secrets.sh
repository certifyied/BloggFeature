#!/bin/bash
# Run this script once to set all environment secrets on your Cloudflare Worker.
# Usage: bash setup-cf-secrets.sh

echo "Setting Cloudflare Worker secrets for 'bloggfeature'..."

echo "https://kwrdpfzrhsossqgmgtgn.supabase.co" | npx wrangler secret put SUPABASE_URL
echo "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3cmRwZnpyaHNvc3NxZ21ndGduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTUyMDUsImV4cCI6MjA5NTU3MTIwNX0.VKQpkghV0c7i2p0HyLyDT0rc8fynTmmV4HsN7o_XIkg" | npx wrangler secret put SUPABASE_ANON_KEY
echo "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3cmRwZnpyaHNvc3NxZ21ndGduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTk5NTIwNSwiZXhwIjoyMDk1NTcxMjA1fQ.dKVYpAPE-nYyp55MDPPCuLCDf8rW9ofwKwfXqPZuM2k" | npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
echo "h7v0i8os3mUEtJ0UY4ruMq+ti2iNApp4IslKh8mLEV6VNlMJzdO6JctWSa8fxYuuwcQZJHjo+KabjHOv6VukRA==" | npx wrangler secret put JWT_SECRET
echo "kabhiram67@gmail.com" | npx wrangler secret put ADMIN_EMAIL
# IMPORTANT: Replace YOUR_RESEND_API_KEY_HERE with your actual key from https://resend.com/api-keys
# echo "YOUR_RESEND_API_KEY_HERE" | npx wrangler secret put RESEND_API_KEY

echo ""
echo "✅ All secrets set! Now deploying..."
npx wrangler deploy
echo "✅ Done! Visit https://bloggfeature.certifyied.workers.dev/adminApiBlog"
