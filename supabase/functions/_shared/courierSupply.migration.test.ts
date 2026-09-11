import { assertEquals } from 'jsr:@std/assert';

const migrationPath = new URL('../../migrations/20260827_dispatch_courier_supply.sql', import.meta.url);
const migrationSql = await Deno.readTextFile(migrationPath);

Deno.test('dispatch courier earning trigger is idempotent for delivered reruns', () => {
  assertEquals(migrationSql.includes('after update of "status" on public."CustomerOrder"'), true);
  // The early-return guard is what makes a delivered rerun a no-op: a row that
  // is not (newly) delivered accrues nothing, and one that was ALREADY
  // delivered never accrues a second earning. This assertion still tracked the
  // pre-`coalesce` spelling of that line; the guard was later made NULL-safe
  // (a NULL status must not read as a delivery) and, because this file was
  // registered in no test list, the drift ran unnoticed. The property asserted
  // is unchanged - only the literal it matches.
  assertEquals(
    migrationSql.includes(
      'if coalesce(new."status", \'\') <> \'delivered\' or coalesce(old."status", \'\') = \'delivered\' then'
    ),
    true
  );
  assertEquals(migrationSql.includes('on conflict ("orderId") do update set'), true);
});
