# HeyGen API Gateway

This Cloudflare Worker is a narrow server-side gateway for the news-avatar workbench. It only permits the HeyGen user check and video create/status endpoints. HeyGen and gateway credentials are stored as encrypted Worker secrets and are never sent to the browser.

Required Worker secrets:

- `HEYGEN_API_KEY`
- `GATEWAY_TOKEN`

After deployment, configure the workbench with the Worker URL in `HEYGEN_API_BASE_URL` and the same random token in `HEYGEN_GATEWAY_TOKEN`.
