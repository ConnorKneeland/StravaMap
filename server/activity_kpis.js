const ActivityKpis = require('../js/activity_kpis');

module.exports = {
    SNAPSHOT_SCHEMA_VERSION: ActivityKpis.SNAPSHOT_SCHEMA_VERSION,
    getActivityKpiValues: ActivityKpis.getActivityKpiValues,
    extractSportMetrics: ActivityKpis.extractSportMetrics,
    buildKpiSnapshots: ActivityKpis.buildKpiSnapshots
};
