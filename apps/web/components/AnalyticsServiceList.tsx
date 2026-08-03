'use client';

// "वापरलेल्या सेवा" — which paid outside services a feature actually ran on, and how much.
//
// A TABLE, not a chart, and that is a deliberate choice rather than a shortcut. The rows are
// measured in incomparable units — calls, images, pages, minutes, characters — so there is no
// shared scale to draw bars against, and a bar chart over mixed units would be a picture that
// lies. What the reader wants here is two exact figures per row, which is a table's job.
//
// Every row is named by CAPABILITY with the provider underneath, so flipping a seam in .env
// changes the small line and not the row, and the history stays continuous.
//
// GROUPED BY TASK. One user-facing task usually runs SEVERAL services — proofreading is a
// chat call plus an embedding lookup, a marker poster revision is a vision call plus an image
// call — and each of those arrived as its own row re-stating the same Marathi task name. The
// repetition read as noise and buried the thing an officer is actually looking for, which is
// what one piece of work costs. The task is now named ONCE, carrying its combined usage and
// total, with the services beneath it as attribution.
//
// A task that ran exactly ONE service is still a single row: there was nothing repeating to
// fix there, and promoting it to a heading plus one indented child would restate the same two
// numbers twice.

import {
  formatNumber,
  formatServiceUnits,
  providerLabel,
  serviceLabel,
  taskLabel,
} from '../lib/analytics';
import { STR } from '../lib/strings';
import type { AnalyticsService } from '@dgipr/schemas';

type ServiceGroup = {
  task: string;
  services: readonly AnalyticsService[];
  // Every service reports `calls` in the same sense — how many times it was invoked — so the
  // group total is a real sum. `units` are NOT summed: pages and minutes do not add up.
  calls: number;
  costInr: number | null;
  costEstimated: boolean;
  recent: boolean;
};

// The API already sorts by task and then by service, so tasks arrive contiguous; insertion
// order is nonetheless what decides the display order here, rather than the grouping
// re-sorting anything the aggregator meant.
function groupByTask(services: readonly AnalyticsService[]): ServiceGroup[] {
  const order: string[] = [];
  const byTask = new Map<string, AnalyticsService[]>();
  for (const service of services) {
    const bucket = byTask.get(service.task);
    if (bucket) {
      bucket.push(service);
      continue;
    }
    byTask.set(service.task, [service]);
    order.push(service.task);
  }

  return order.map((task) => {
    const rows = byTask.get(task) ?? [];
    // "Not priced" and "₹0" are different answers, so the total stays null until at least
    // one service in the group actually carries a figure — the same distinction the single
    // row below draws with its dash.
    const priced = rows.filter((row) => row.costInr !== null);
    return {
      task,
      services: rows,
      calls: rows.reduce((sum, row) => sum + row.calls, 0),
      costInr:
        priced.length === 0
          ? null
          : Math.round(
              priced.reduce((sum, row) => sum + (row.costInr ?? 0), 0) * 100,
            ) / 100,
      // A total that aggregates an estimated figure is itself partly estimated. Marking only
      // the detail row would let the reader take the number they actually quote as measured.
      costEstimated: rows.some(
        (row) => row.costEstimated && (row.costInr ?? 0) > 0,
      ),
      recent: rows.some((row) => row.eventBacked && row.legacy),
    };
  });
}

function ServiceFlags({
  estimated,
  recent,
}: {
  estimated: boolean;
  recent: boolean;
}) {
  return (
    <>
      {/* Marked on the row itself. A footnote at the bottom of the card arrives after the
          reader has already taken the number as measured. */}
      {estimated ? (
        <span
          className="service-flag"
          title={STR.analyticsServiceEstimatedTitle}
        >
          {STR.analyticsServiceEstimated}
        </span>
      ) : null}
      {recent ? (
        <span className="service-flag" title={STR.analyticsServiceRecentTitle}>
          {STR.analyticsServiceRecent}
        </span>
      ) : null}
    </>
  );
}

// A genuine zero is shown as a dash rather than as ₹0: on the OpenAI OCR path the pages
// really are billed inside the text row above, and "₹0" would read as "free" instead of
// "counted elsewhere".
function ServiceCost({ costInr }: { costInr: number | null }) {
  if (costInr === null || costInr === 0) {
    return <span className="service-cost-none">—</span>;
  }
  return <>{`₹${formatNumber(costInr)}`}</>;
}

function serviceDetail(service: AnalyticsService): string {
  return [
    service.provider ? providerLabel(service.provider) : '',
    service.model,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function AnalyticsServiceList({
  services,
}: {
  services: readonly AnalyticsService[];
}) {
  if (services.length === 0) {
    return <p className="hint">{STR.analyticsServicesNone}</p>;
  }

  const groups = groupByTask(services);

  return (
    <div className="service-table-wrap">
      <table className="service-table">
        <thead>
          <tr>
            <th scope="col">{STR.analyticsServiceTableTask}</th>
            <th scope="col" className="service-units">
              {STR.analyticsServiceTableUsage}
            </th>
            <th scope="col" className="service-cost">
              {STR.analyticsServiceTableCost}
            </th>
          </tr>
        </thead>
        {groups.map((group) => {
          // One tbody per task, so the group is a real structure rather than an indent:
          // screen readers announce the task as the row group's header, and the divider
          // between tasks is a border between tbodies rather than one on every row.
          const single = group.services.length === 1 ? group.services[0] : null;

          if (single) {
            return (
              <tbody key={group.task}>
                <tr>
                  <th scope="row">
                    <span className="service-name">
                      {taskLabel(group.task)}
                    </span>
                    <span className="service-provider">
                      {[serviceLabel(single.key), serviceDetail(single)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </th>
                  <td className="service-units">
                    <span>{`${formatNumber(single.calls)} ${STR.analyticsUnitCalls}`}</span>
                    {single.unit !== 'calls' ? (
                      <span className="service-provider">
                        {formatServiceUnits(single.units, single.unit)}
                      </span>
                    ) : null}
                  </td>
                  <td className="service-cost">
                    <ServiceCost costInr={single.costInr} />
                    <ServiceFlags
                      estimated={group.costEstimated}
                      recent={group.recent}
                    />
                  </td>
                </tr>
              </tbody>
            );
          }

          return (
            <tbody key={group.task}>
              <tr className="service-group-head">
                <th scope="rowgroup">{taskLabel(group.task)}</th>
                <td className="service-units">
                  {`${formatNumber(group.calls)} ${STR.analyticsUnitCalls}`}
                </td>
                <td className="service-cost">
                  <ServiceCost costInr={group.costInr} />
                  <ServiceFlags
                    estimated={group.costEstimated}
                    recent={group.recent}
                  />
                </td>
              </tr>
              {group.services.map((service) => (
                <tr
                  className="service-detail"
                  key={`${service.key}:${service.provider}:${service.model}`}
                >
                  <th scope="row">
                    <span className="service-detail-name">
                      {serviceLabel(service.key)}
                    </span>
                    <span className="service-provider">
                      {serviceDetail(service)}
                    </span>
                  </th>
                  <td className="service-units">
                    <span>{`${formatNumber(service.calls)} ${STR.analyticsUnitCalls}`}</span>
                    {service.unit !== 'calls' ? (
                      <span className="service-provider">
                        {formatServiceUnits(service.units, service.unit)}
                      </span>
                    ) : null}
                  </td>
                  <td className="service-cost">
                    <ServiceCost costInr={service.costInr} />
                  </td>
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
