// lib/downtime-metrics.ts
//
// Before-vs-after downtime accounting.
//
// Deliberately plain arithmetic, shared by /api/optimize-schedule and the
// autonomous agent so the two can never report different numbers for the same
// plan. These figures are quoted to a Sr. DEN; summing hours is not something
// to delegate to a language model.

import {
  DELAY_ASSUMPTIONS,
  type CorridorWindow,
  type DowntimeMetrics,
  type MaintenanceDefect,
  type OptimizedBlock,
} from '@/lib/types'

export function computeDowntimeMetrics(
  blocks: OptimizedBlock[],
  defects: MaintenanceDefect[],
  windows: CorridorWindow[]
): DowntimeMetrics {
  const durationByAsset = new Map(
    defects.map((d) => [d.asset_id, Number(d.duration_required_hrs) || 0])
  )
  const densityBySection = new Map(
    windows.map((w) => [w.section_code, w.passenger_traffic_density])
  )

  let uncoordinated = 0
  let joint = 0
  let tasks = 0
  let delayMinutes = 0
  let notExecutable = 0

  for (const block of blocks) {
    const blockTasks = block.combined_tasks ?? []
    tasks += blockTasks.length

    const separateHours = blockTasks.reduce(
      (sum, task) => sum + (durationByAsset.get(task.asset) ?? 0),
      0
    )

    const start = Date.parse(block.block_window_start)
    const end = Date.parse(block.block_window_end)
    const wallClockHours =
      Number.isFinite(start) && Number.isFinite(end) && end > start
        ? (end - start) / 3_600_000
        : separateHours

    // Departments work in parallel inside a joint block, so the shortest
    // possible possession is the longest single task. A window below that
    // cannot be executed, and would otherwise inflate the apparent saving.
    const longestTask = blockTasks.reduce(
      (max, task) => Math.max(max, durationByAsset.get(task.asset) ?? 0),
      0
    )
    if (wallClockHours + 1e-9 < longestTask) notExecutable += 1

    uncoordinated += separateHours
    joint += wallClockHours

    const hoursSaved = Math.max(0, separateHours - wallClockHours)
    const density = densityBySection.get(block.section_code) ?? 'Medium'
    const trainsPerHour = DELAY_ASSUMPTIONS.trainsPerHour[density] ?? 6
    delayMinutes += hoursSaved * trainsPerHour * DELAY_ASSUMPTIONS.minutesPerTrain
  }

  const round = (n: number) => Math.round(n * 100) / 100

  return {
    total_uncoordinated_hours: round(uncoordinated),
    joint_block_hours: round(joint),
    downtime_reduction_percent:
      uncoordinated > 0 ? round(((uncoordinated - joint) / uncoordinated) * 100) : 0,
    passenger_delay_minutes_saved: Math.round(delayMinutes),
    tasks_planned: tasks,
    blocks_planned: blocks.length,
    blocks_not_executable: notExecutable,
  }
}

/**
 * Longest single task in a block — the floor on how short its possession can
 * physically be, since departments work concurrently.
 */
export function minimumFeasibleHours(
  block: OptimizedBlock,
  defects: MaintenanceDefect[]
): number {
  const durationByAsset = new Map(
    defects.map((d) => [d.asset_id, Number(d.duration_required_hrs) || 0])
  )
  return (block.combined_tasks ?? []).reduce(
    (max, task) => Math.max(max, durationByAsset.get(task.asset) ?? 0),
    0
  )
}
