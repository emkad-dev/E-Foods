do $$
begin
  alter publication supabase_realtime add table public."UserAccount";
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public."UserRole";
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public."RestaurantRecord";
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public."RestaurantApproval";
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public."CustomerOrder";
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public."OrderItem";
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public."DeliveryAssignment";
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public."DispatchRiderRecord";
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public."DispatchApplicationRecord";
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public."PartnerApplicationRecord";
exception
  when duplicate_object then null;
end $$;
