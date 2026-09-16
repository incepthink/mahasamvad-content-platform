# Runpod Qwen 27B Serverless benchmark — 2026-09-15

## Deployment tested

- Endpoint: `b1e9gmrhux5yam` (`vLLM v2.26.0 qwen3.8-27b`)
- Exact served model ID: `qwen/qwen3.8-27b`
- Endpoint type: queue-based Runpod Serverless
- GPUs per worker: 1
- Active workers: 0
- Maximum workers: 3
- Scaler: queue delay, 4 seconds
- Idle timeout: 5 seconds
- Worker rates observed through the Runpod API: $1.59/hour and $2.09/hour during
  this test; an older endpoint worker record used $3.49/hour

The calculations below use the $2.09/hour rate of the worker that processed the
successful benchmark jobs. Runpod bills worker startup, execution, and idle tail by
the second. The Billing API had not yet posted records for the test window, so the
Runpod Billing tab remains authoritative for the final charge.

## Results

| Workload                                            | Result | Queue delay | Execution time per job | Output tokens | Batch wall time | Processing workers |
| --------------------------------------------------- | -----: | ----------: | ---------------------: | ------------: | --------------: | -----------------: |
| Smoke, 1 request, 16-token cap, thinking off        |    1/1 |     193.0 s |                  1.5 s |            16 |         195.3 s |                  1 |
| Chat, 5 simultaneous, 128-token cap, thinking off   |    5/5 |      2.27 s |            7.21–7.36 s |     638 total |          11.1 s |                  1 |
| Chat, 15 simultaneous, 128-token cap, thinking off  |  15/15 | 6.43–6.75 s |          11.49–12.30 s |   1,886 total |          20.8 s |                  1 |
| Chat, 25 simultaneous, 128-token cap, thinking off  |  25/25 | 7.14–7.73 s |          16.01–17.38 s |   3,144 total |          26.9 s |                  1 |
| Chat, 25 simultaneous, 512-token cap, thinking on   |  25/25 | 4.56–4.99 s |          44.56–52.17 s |  12,549 total |          59.0 s |                  1 |
| DLO, 15 simultaneous, 1,024-token cap, thinking off |  15/15 | 4.92–4.96 s |           9.24–19.63 s |   2,875 total |          25.2 s |                  1 |

All 86 valid generation jobs completed successfully. One earlier smoke job failed
after startup because the Hub label's capitalization was not the exact case-sensitive
vLLM model ID; that configuration issue is now fixed.

## Capacity conclusion

One GPU accepted and completed all 25 concurrent chat generations. The practical
tradeoff is latency: at about 500 completion tokens with Qwen thinking enabled, each
user waited approximately 50–57 seconds including the warm queue delay.

The endpoint health counters scaled to three running workers during the 15- and
25-request bursts, but every completed job named the same processing worker. The two
extra starts therefore did not improve these batches and can add cost. Start production
with one maximum worker if this latency is acceptable, then increase it only after a
test proves that multiple workers actually split the jobs.

## Measured cost model for 25 users

The 25-request, 512-token, thinking-enabled batch used an estimated 61.85 billable
processing-worker seconds including a five-second idle tail:

- One warm 25-user batch: about **$0.0359** at $2.09/hour
- Lower-bound warm cost per generation: about **$0.00144**
- One cold 25-user batch using the measured 193-second startup: about **$0.146**
  on one worker

The current scaler may start as many as three workers. If all three spend comparable
time starting, a cold burst can approach three times the one-worker cold-start cost.
The observed slow worker shutdown can increase it further; check Billing before using
the upper number as a budget commitment.

At the last successful post-test check, Runpod still marked worker
`frknjxmceft9c3` as running at $2.09/hour even though the endpoint reported no queued
or in-progress jobs. The normal Pod stop API does not accept Serverless worker IDs.
Verify that this worker has exited in the endpoint's Workers tab and terminate it there
if it is still present.

Assuming 22 working days and 25 users, where each user makes the stated number of
roughly 500-token chat generations per day:

| Generations per user/day | Monthly requests | Warm, tightly batched lower bound | Every 25-user burst cold, one worker | Every burst starts 3 workers, rough ceiling |
| -----------------------: | ---------------: | --------------------------------: | -----------------------------------: | ------------------------------------------: |
|                        1 |              550 |                             $0.79 |                                $3.21 |                                       $9.63 |
|                        5 |            2,750 |                             $3.95 |                               $16.05 |                                      $48.15 |
|                       10 |            5,500 |                             $7.90 |                               $32.10 |                                      $96.30 |
|                       20 |           11,000 |                            $15.80 |                               $64.20 |                                     $192.60 |

These figures exclude container-disk charges and do not describe isolated requests.
With a five-second idle timeout, sporadic requests will repeatedly pay the approximately
three-minute cold start and give poor chat UX. If one worker stays active at the observed
$2.09/hour rate, the compute equivalent is about $368 for 8 hours × 22 working days, or
about $1,505 for 24/7 over a 30-day month; Runpod may apply a different Active-worker
rate.

## Recommended production starting point

1. Set maximum workers to 1 initially; the test proves one worker handles 25 concurrent
   requests and prevents the four-second queue scaler from starting unused workers.
2. Raise the idle timeout from 5 seconds to 5–15 minutes for workday traffic, or schedule
   one active worker only during office hours if the three-minute first-request delay is
   unacceptable.
3. Track real `prompt_tokens`, `completion_tokens`, request timestamps, queue delay,
   execution time, and Runpod Billing for two weeks. Recalculate using actual DLO/chat
   proportions and request spacing.
4. Increase to two workers only if measured user latency is too high and a controlled
   test confirms that jobs are distributed across both worker IDs.
