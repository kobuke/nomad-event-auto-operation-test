
import { checkDeadlines } from './deadlineChecker.js';
import { reconcileRsvps } from './rsvpReconciler.js';
import { checkUnsentPayments } from './paymentChecker.js';

async function runAllJobs() {
  console.log('🚀 Starting all cron jobs...');

  try {
    console.log('--- Running Deadline Checker ---');
    await checkDeadlines();
    console.log('--- Finished Deadline Checker ---');
  } catch (error) {
    console.error('❌ Deadline Checker failed:', error);
  }

  try {
    console.log('--- Running RSVP Reconciler ---');
    await reconcileRsvps();
    console.log('--- Finished RSVP Reconciler ---');
  } catch (error) {
    console.error('❌ RSVP Reconciler failed:', error);
  }

  try {
    console.log('--- Running Payment Checker ---');
    await checkUnsentPayments();
    console.log('--- Finished Payment Checker ---');
  } catch (error) {
    console.error('❌ Payment Checker failed:', error);
  }

  console.log('✅ All cron jobs finished.');
}

runAllJobs();
