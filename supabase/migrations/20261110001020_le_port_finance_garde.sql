-- LE PORT — garde des fonctions d'émission : appelées depuis le navigateur, elles exigent un fondateur de l'allowlist
-- (le serveur et le moteur passent par service_role, qui n'a pas de rôle « authenticated »).
create or replace function public.exiger_fondateur()
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  claims text := nullif(current_setting('request.jwt.claims', true), '');
begin
  if claims is not null and (claims::jsonb ->> 'role') in ('authenticated', 'anon') and not public.is_allowed() then
    raise exception 'Non autorisé.';
  end if;
end;
$$;

create or replace function public.emettre_facture(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare f public.invoices; num text;
begin
  perform public.exiger_fondateur();
  select * into f from public.invoices where id = p_id for update;
  if not found then raise exception 'Facture introuvable.'; end if;
  if f.statut <> 'brouillon' then return f.numero; end if;
  if f.client_id is null then raise exception 'Choisis un client avant d''émettre.'; end if;
  if jsonb_array_length(f.lignes) = 0 then raise exception 'La facture n''a aucune ligne.'; end if;
  num := public.prochain_numero(case when f.type = 'avoir' then 'A' else 'F' end, extract(year from current_date)::int);
  update public.invoices set numero = num, statut = 'emise', emis_le = current_date,
    echeance = case when f.type = 'avoir' then null else current_date + f.delai_jours end,
    client_snapshot = public.client_fige(f.client_id)
  where id = p_id;
  return num;
end;
$$;

create or replace function public.emettre_devis(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare d public.quotes; num text; validite integer;
begin
  perform public.exiger_fondateur();
  select * into d from public.quotes where id = p_id for update;
  if not found then raise exception 'Devis introuvable.'; end if;
  if d.statut <> 'brouillon' then return d.numero; end if;
  if d.client_id is null then raise exception 'Choisis un client avant d''émettre.'; end if;
  if jsonb_array_length(d.lignes) = 0 then raise exception 'Le devis n''a aucune ligne.'; end if;
  select coalesce((finance ->> 'validite_devis')::int, 30) into validite from public.settings where id = 1;
  num := public.prochain_numero('D', extract(year from current_date)::int);
  update public.quotes set numero = num, statut = 'emis', emis_le = current_date,
    valable_jusqu = current_date + coalesce(validite, 30), client_snapshot = public.client_fige(d.client_id)
  where id = p_id;
  return num;
end;
$$;

create or replace function public.creer_avoir(p_facture uuid, p_motif text, p_lignes jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare f public.invoices; nid uuid; l jsonb;
begin
  perform public.exiger_fondateur();
  select * into f from public.invoices where id = p_facture for update;
  if not found or f.type <> 'facture' or f.statut in ('brouillon') then raise exception 'Avoir possible uniquement sur une facture émise.'; end if;
  l := coalesce(p_lignes, (select jsonb_agg(x || jsonb_build_object('prix_unitaire', -abs((x ->> 'prix_unitaire')::numeric))) from jsonb_array_elements(f.lignes) x));
  insert into public.invoices (type, client_id, objet, lignes, avoir_de, activite, notes, cree_par, delai_jours)
  values ('avoir', f.client_id, 'Avoir sur la facture ' || f.numero, l, f.id, f.activite, p_motif, 'avoir', 0)
  returning id into nid;
  perform public.emettre_facture(nid);
  if public.lignes_total(l) <= -f.total then
    update public.invoices set statut = 'annulee' where id = f.id;
  end if;
  return nid;
end;
$$;

-- fonction de déclencheur : jamais appelable directement
revoke all on function public.paiement_statut() from public, anon, authenticated;
revoke all on function public.exiger_fondateur() from public, anon;

-- nuit au port (routine réglable : les agents sans tâche rentrent chez eux, Lucie et Jade de garde)
insert into public.routines (id, nom, agent_id, mode, heure, intervalle_minutes, plage_debut, plage_fin, jours, prompt_tache, actif)
values ('rt_nuit', 'Nuit au port', 'clemence', 'intervalle', '20:00', 5, '20:00', '08:00', '{}', 'Les agents sans tâche rentrent chez eux la nuit ; Lucie et Jade restent de garde. Une tâche réveille l''agent concerné. Aucun crédit utilisé.', true)
on conflict (id) do nothing;
