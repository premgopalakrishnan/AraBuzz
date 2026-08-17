/**
 * A deliberately boring endpoint. Its only job is to prove, on the very first
 * deployment, that serverless functions run on this project — before anything
 * important depends on them.
 *
 * Visit https://<your-site>/api/health
 */
export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    app: 'arabuzz',
    now: new Date().toISOString(),
    // These stay false until the environment variables are added in Vercel.
    // Nothing secret is ever revealed here — only whether a value is present.
    configured: {
      anthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
      supabaseUrl: Boolean(process.env.SUPABASE_URL),
      supabaseAnonKey: Boolean(process.env.SUPABASE_ANON_KEY),
      supabaseServiceKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      resendKey: Boolean(process.env.RESEND_API_KEY),
      cronSecret: Boolean(process.env.CRON_SECRET)
    }
  });
}
