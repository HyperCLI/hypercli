/**
 * Example: Create and manage a GPU job
 */
import { HyperCLI } from '../src/index.js';

async function main() {
  const client = new HyperCLI();
  
  console.log('Creating GPU job...');
  
  const job = await client.jobs.create({
    image: 'nvidia/cuda:12.0-runtime-ubuntu22.04',
    gpuType: 'l40s',
    gpuCount: 1,
    runtime: 3600, // 1 hour
    command: 'nvidia-smi && sleep 3600',
    env: {
      MY_VAR: 'hello',
    },
  });
  
  console.log('\n✅ Job created!');
  console.log(`Job ID: ${job.jobId}`);
  console.log(`State: ${job.state}`);
  console.log(`GPU: ${job.gpuCount}x ${job.gpuType}`);
  console.log(`Price: $${job.pricePerHour}/hr`);
  
  // Wait for running
  console.log('\nWaiting for job to start...');
  let attempts = 0;
  while (attempts < 60) {
    const updated = await client.jobs.get(job.jobId);
    console.log(`State: ${updated.state}`);
    
    if (updated.state === 'running') {
      console.log(`✅ Job is running!`);
      console.log(`Hostname: ${updated.hostname}`);
      break;
    }
    
    if (['failed', 'cancelled', 'completed'].includes(updated.state)) {
      console.log(`❌ Job ended with state: ${updated.state}`);
      break;
    }
    
    await new Promise(r => setTimeout(r, 5000));
    attempts++;
  }
  
  // Get logs
  console.log('\nFetching logs...');
  const logs = await client.jobs.logs(job.jobId);
  console.log(logs || '(no logs yet)');
  
  // Cancel job
  console.log('\nCancelling job...');
  await client.jobs.cancel(job.jobId);
  console.log('✅ Job cancelled');
}

main().catch(console.error);
