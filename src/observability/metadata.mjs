export const GOAL_RELATION_REASONS=Object.freeze([
  'goal-state-not-observed','canonical-turn-relation-unavailable','explicit-no-current-goal',
  'goal-or-turn-start-time-unavailable','turn-predates-current-goal',
  'goal-not-active-turn-relation-unproven','goal-identity-unavailable',
  'canonical-turn-starts-within-current-active-goal',
  'goal-relation-not-observed','goal-relation-reason-unrecognized','session-log-goal-identifier',
]);
export const safeGoalId=value=>typeof value==='string'&&/^[a-zA-Z0-9._-]{1,128}$/.test(value)?value:null;
export function observedGoalRelation({kind,goalId,goalRelationReason,goalAttributionReason}={}) {
  const raw=goalRelationReason??goalAttributionReason;
  const reason=raw==null?'goal-relation-not-observed':GOAL_RELATION_REASONS.includes(raw)?raw:'goal-relation-reason-unrecognized';
  const id=safeGoalId(goalId);
  if(reason==='canonical-turn-starts-within-current-active-goal'&&kind==='goal'&&id)return {kind:'goal',goalId:id,goalRelationReason:reason,goalRelationQuality:'Observed'};
  if(reason==='explicit-no-current-goal'&&kind==='ordinary'&&!id)return {kind:'ordinary',goalId:null,goalRelationReason:reason,goalRelationQuality:'Not a Goal'};
  return {kind:null,goalId:null,goalRelationReason:reason==='canonical-turn-starts-within-current-active-goal'?'goal-identity-unavailable':reason,goalRelationQuality:'Unavailable'};
}
