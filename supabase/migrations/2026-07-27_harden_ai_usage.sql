create or replace function claim_ai_usage(
  p_cost integer default 1,
  p_action_type text default 'ai_request',
  p_user_daily_limit integer default 50,
  p_app_daily_limit integer default 500,
  p_minute_limit integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_cost integer := 1;
  v_user_daily_limit integer := 50;
  v_app_daily_limit integer := 500;
  v_minute_limit integer := 30;
  v_day_start timestamptz := (date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo');
  v_minute_start timestamptz := now() - interval '1 minute';
  v_user_used integer := 0;
  v_app_used integer := 0;
  v_minute_used integer := 0;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  perform pg_advisory_xact_lock(hashtext('my-planner-ai-usage'));

  select coalesce(sum(cost), 0) into v_user_used
    from ai_usage_events
    where user_id = v_user_id and created_at >= v_day_start;
  select coalesce(sum(cost), 0) into v_app_used
    from ai_usage_events
    where created_at >= v_day_start;
  select coalesce(sum(cost), 0) into v_minute_used
    from ai_usage_events
    where created_at >= v_minute_start;

  if v_user_used + v_cost > v_user_daily_limit then
    return jsonb_build_object('ok', false, 'reason', 'user_daily_limit',
      'userUsedToday', v_user_used, 'userDailyLimit', v_user_daily_limit,
      'userRemaining', greatest(0, v_user_daily_limit - v_user_used));
  end if;
  if v_app_used + v_cost > v_app_daily_limit then
    return jsonb_build_object('ok', false, 'reason', 'app_daily_limit',
      'userUsedToday', v_user_used, 'userDailyLimit', v_user_daily_limit,
      'userRemaining', greatest(0, v_user_daily_limit - v_user_used));
  end if;
  if v_minute_used + v_cost > v_minute_limit then
    return jsonb_build_object('ok', false, 'reason', 'minute_limit',
      'userUsedToday', v_user_used, 'userDailyLimit', v_user_daily_limit,
      'userRemaining', greatest(0, v_user_daily_limit - v_user_used));
  end if;

  insert into ai_usage_events (user_id, action_type, cost)
  values (v_user_id, coalesce(nullif(left(p_action_type, 60), ''), 'ai_request'), v_cost);

  return jsonb_build_object(
    'ok', true,
    'cost', v_cost,
    'userUsedToday', v_user_used + v_cost,
    'userDailyLimit', v_user_daily_limit,
    'userRemaining', greatest(0, v_user_daily_limit - v_user_used - v_cost),
    'appUsedToday', v_app_used + v_cost
  );
end;
$$;

revoke all on function claim_ai_usage(integer, text, integer, integer, integer) from public;
grant execute on function claim_ai_usage(integer, text, integer, integer, integer) to authenticated;
drop function if exists refund_ai_usage(uuid);
