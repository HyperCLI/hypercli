/**
 * Basic usage example for @hypercli/sdk
 */
import { HyperCLI } from '../src/index.js';

async function main() {
  try {
    // Initialize client (will use HYPERCLI_API_KEY from env or ~/.hypercli/config)
    const client = new HyperCLI();
    
    console.log('✅ Client initialized');
    console.log(`API URL: ${client.apiUrl}`);
    
    // Get balance
    const balance = await client.billing.balance();
    console.log(`\n💰 Balance: $${balance.total}`);
    console.log(`   Available: $${balance.available}`);
    console.log(`   Rewards: $${balance.rewards}`);
    
    // List running jobs
    const jobs = await client.jobs.list('running');
    console.log(`\n🚀 Running jobs: ${jobs.length}`);
    
    for (const job of jobs.slice(0, 3)) {
      console.log(`   - ${job.jobId}`);
      console.log(`     GPU: ${job.gpuCount}x ${job.gpuType}`);
      console.log(`     State: ${job.state}`);
      console.log(`     Hostname: ${job.hostname || 'N/A'}`);
    }
    
    // Get user info
    const user = await client.user.get();
    console.log(`\n👤 User: ${user.email || user.userId}`);
    
    // List available GPU types
    const gpuTypes = await client.instances.types();
    console.log(`\n💻 Available GPU types: ${Object.keys(gpuTypes).length}`);
    console.log(`   ${Object.keys(gpuTypes).slice(0, 5).join(', ')}...`);
    
    console.log('\n✨ All API calls successful!');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
