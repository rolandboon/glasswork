/**
 * @module glasswork/jobs/scheduler
 * EventBridge Scheduler driver for one-off schedules. Requires `@aws-sdk/client-scheduler`.
 */
export {
  type EventBridgeSchedulerConfig,
  EventBridgeSchedulerDriver,
  type ScheduleResult,
} from './drivers/eventbridge-scheduler-driver.js';
