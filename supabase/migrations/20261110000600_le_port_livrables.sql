-- LE PORT — échanges de type « livrable » (un compte rendu remonte vers l'agent qui l'a demandé)
-- et index pour retrouver vite les échanges d'une tâche (vue « Flux »).
alter table public.agent_messages drop constraint if exists agent_messages_type_check;
alter table public.agent_messages
  add constraint agent_messages_type_check check (type in ('question', 'reponse', 'delegation', 'livrable', 'bavardage'));

create index if not exists agent_messages_task on public.agent_messages (task_id, cree_le);
create index if not exists tasks_mission on public.tasks (mission_id, cree_le);
