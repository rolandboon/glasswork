import { describe, expect, it } from 'vitest';
import {
  generateJobsDashboard,
  getJobsInsightsQueries,
} from '../../../src/jobs/observability/dashboard.js';

describe('CloudWatch Dashboard & Insights Generator', () => {
  it('generates valid CloudWatch Dashboard JSON definition', () => {
    const dashboard = generateJobsDashboard({
      dashboardName: 'App-Jobs-Monitoring',
      namespace: 'Glasswork/Jobs',
      jobNames: ['sendEmail', 'tallyVotes'],
      periodSeconds: 300,
      region: 'eu-west-1',
    });

    expect(dashboard.dashboardName).toBe('App-Jobs-Monitoring');
    const parsed = JSON.parse(dashboard.dashboardBody);
    expect(parsed.widgets).toHaveLength(4);

    const throughputWidget = parsed.widgets[0];
    expect(throughputWidget.type).toBe('metric');
    expect(throughputWidget.properties.title).toContain('Throughput');
    expect(throughputWidget.properties.metrics).toHaveLength(2);
    expect(throughputWidget.properties.metrics[0][3]).toBe('sendEmail');
    expect(throughputWidget.properties.metrics[1][3]).toBe('tallyVotes');

    const errorWidget = parsed.widgets[1];
    expect(errorWidget.properties.title).toContain('Errors');

    const durationWidget = parsed.widgets[2];
    expect(durationWidget.properties.metrics[0][2].stat).toBe('p50');
    expect(durationWidget.properties.metrics[1][2].stat).toBe('p90');
    expect(durationWidget.properties.metrics[2][2].stat).toBe('p99');
  });

  it('includes log widget when logGroupName is specified', () => {
    const dashboard = generateJobsDashboard({
      dashboardName: 'App-Jobs-With-Logs',
      logGroupName: '/aws/lambda/worker-prod',
    });

    const parsed = JSON.parse(dashboard.dashboardBody);
    expect(parsed.widgets).toHaveLength(5);
    const logWidget = parsed.widgets[4];
    expect(logWidget.type).toBe('log');
    expect(logWidget.properties.query).toContain("SOURCE '/aws/lambda/worker-prod'");
  });

  it('generates pre-canned CloudWatch Logs Insights queries', () => {
    const queries = getJobsInsightsQueries({
      logGroupName: '/aws/lambda/app-worker',
    });

    expect(queries.recentFailures).toContain("SOURCE '/aws/lambda/app-worker'");
    expect(queries.recentFailures).toContain('filter Status in ["failed", "dead_letter"]');
    expect(queries.slowestJobs).toContain('sort JobDuration desc');
    expect(queries.retriedJobs).toContain('filter AttemptNumber > 1');
    expect(queries.throughputHourly).toContain('stats count(*) as Total');

    const traceQuery = queries.traceJob('job-xyz');
    expect(traceQuery).toContain('filter JobId = "job-xyz"');
  });
});
