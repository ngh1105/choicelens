/** @type {import('next').NextConfig} */
// Vercel CLI 54's preview comments adapter expects a `projectDir` field that
// Next 16.2.6 does not pass to `modifyConfig`. Disable that injection so
// preview deployments can build; the separate preview-comments check still
// runs on the PR.
if (process.env.NEXT_ADAPTER_PATH && process.env.VERCEL_PREVIEW_COMMENTS_ENABLED === "1") {
  process.env.VERCEL_PREVIEW_COMMENTS_ENABLED = "0";
}

const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
