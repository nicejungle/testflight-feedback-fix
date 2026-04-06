import { loadAppStoreConnectEnv, fetchAppStoreFeedbackSummary } from '../lib/app-store-connect';

async function main() {
  const env = loadAppStoreConnectEnv(process.env);
  const summary = await fetchAppStoreFeedbackSummary({ env, limit: 50 });
  console.log(JSON.stringify(summary.combined));
}

main();
