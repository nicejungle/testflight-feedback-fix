import { loadAppStoreConnectEnv, fetchAppStoreFeedbackSummary } from '../lib/app-store-connect';
import * as fs from 'fs';

async function main() {
  try {
    const env = loadAppStoreConnectEnv(process.env);
    const summary = await fetchAppStoreFeedbackSummary({ env, limit: 10 });

    const processedFile = '../.github/processed-feedback.json';
    let processed: string[] = [];
    try { processed = JSON.parse(fs.readFileSync(processedFile, 'utf8')); } catch {}

    const webhookId = process.env.FEEDBACK_ID;
    let newItems;
    if (webhookId && webhookId !== '') {
      newItems = summary.combined.filter(item => item.id === webhookId);
      if (newItems.length === 0) {
        newItems = summary.combined.filter(item => !processed.includes(item.id));
      }
    } else {
      newItems = summary.combined.filter(item => !processed.includes(item.id));
    }

    if (newItems.length === 0) {
      console.log('No new feedback');
      fs.writeFileSync('/tmp/feedback.json', '[]');
    } else {
      console.log(`Found ${newItems.length} new feedback items`);
      fs.writeFileSync('/tmp/feedback.json', JSON.stringify(newItems, null, 2));
    }
  } catch (e: any) {
    console.error('Failed to fetch feedback:', e.message);
    fs.writeFileSync('/tmp/feedback.json', '[]');
  }
}

main();
