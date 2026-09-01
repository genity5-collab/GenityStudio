# External References

The secure Render deployment configuration follows the official FastAPI quickstart, which specifies a Python build command and a `uvicorn` start command that binds to the service port. [Render FastAPI deployment](https://render.com/docs/deploy-fastapi)

Render’s environment-variable guidance requires secret values to be stored in the service environment or Blueprint placeholders rather than committed to source control. [Render environment variables and secrets](https://render.com/docs/configure-environment-variables)

Render web services require a process that binds to `0.0.0.0` on the assigned `PORT`; public requests use TLS at the platform edge. [Render web services](https://render.com/docs/web-services)

Supabase Edge Functions and server-side secret guidance remain relevant to the existing production function boundary. [Supabase Edge Functions](https://supabase.com/docs/guides/functions) [Supabase secrets](https://supabase.com/docs/guides/functions/secrets) [Supabase function authentication](https://supabase.com/docs/guides/functions/auth)

Render supports a separate static-site service for React frontends and redirects HTTP traffic to HTTPS. The Blueprint specification represents such a service as `type: web` with `runtime: static`, a build command, a static publish path, headers, and SPA rewrite routes. [Render static sites](https://render.com/docs/static-sites) [Render Blueprint specification](https://render.com/docs/blueprint-spec)
