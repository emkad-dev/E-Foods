import { assertEquals } from 'jsr:@std/assert';

const migrationPath = new URL('../../migrations/20260827_dispatch_courier_supply.sql', import.meta.url);
const migrationSql = await Deno.readTextFile(migrationPath);

Deno.test('dispatch courier earning trigger is idempotent for delivered reruns', () => {
  assertEquals(migrationSql.includes('after update of "status" on public."CustomerOrder"'), true);
  assertEquals(migrationSql.includes('if new."status" <> \'delivered\' or old."status" = \'delivered\' then'), true);
  assertEquals(migrationSql.includes('on conflict ("orderId") do update set'), true);
});
