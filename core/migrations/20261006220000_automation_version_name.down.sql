-- Refuse to discard named immutable versions or invalidate their stored digest.
do $$
begin
    if exists (select 1 from catalog.automation_version where name is not null) then
        raise exception 'Named automation versions exist; rollback would lose immutable version content';
    end if;
end $$;
alter table catalog.automation_version drop column name;
