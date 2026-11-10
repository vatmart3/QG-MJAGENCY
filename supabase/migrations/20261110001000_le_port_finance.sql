-- LE PORT — Phase 6 : finance (clients, devis, factures, avoirs, paiements, abonnements, MJ E-comm).
-- Règles légales : numérotation continue et sans trou générée en base, facture émise verrouillée
-- (correction uniquement par avoir), PDF archivé avec empreinte SHA-256.

-- ------------------------------------------------------------------ clients
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (length(trim(nom)) between 1 and 200),
  contact text,
  email text,
  telephone text,
  adresse text,
  code_postal text,
  ville text,
  siret text,
  type text not null default 'pro' check (type in ('pro', 'particulier')),
  notes text,
  importe boolean not null default false,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index if not exists clients_nom on public.clients (lower(nom));

-- ------------------------------------------------------------------ numérotation (F-2026-0001, D-2026-0001, A-2026-0001)
create table if not exists public.numerotation (
  prefixe text not null check (prefixe in ('F', 'D', 'A')),
  annee integer not null,
  dernier integer not null default 0,
  primary key (prefixe, annee)
);

create or replace function public.prochain_numero(p_prefixe text, p_annee integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.numerotation (prefixe, annee, dernier) values (p_prefixe, p_annee, 1)
  on conflict (prefixe, annee) do update set dernier = public.numerotation.dernier + 1
  returning dernier into n;
  return p_prefixe || '-' || p_annee || '-' || lpad(n::text, 4, '0');
end;
$$;
revoke all on function public.prochain_numero(text, integer) from public, anon, authenticated;

-- ------------------------------------------------------------------ devis
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  numero text unique,
  client_id uuid references public.clients (id) on delete restrict,
  client_snapshot jsonb,
  objet text not null default '',
  lignes jsonb not null default '[]'::jsonb,
  total numeric(12, 2) not null default 0,
  statut text not null default 'brouillon' check (statut in ('brouillon', 'emis', 'envoye', 'accepte', 'refuse', 'expire')),
  emis_le date,
  valable_jusqu date,
  conditions text,
  activite text not null default 'agence' check (activite in ('agence', 'ecomm')),
  pdf_path text,
  pdf_sha256 text,
  notes text,
  cree_par text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);

-- ------------------------------------------------------------------ factures et avoirs
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'facture' check (type in ('facture', 'avoir')),
  numero text unique,
  client_id uuid references public.clients (id) on delete restrict,
  client_snapshot jsonb,
  objet text not null default '',
  lignes jsonb not null default '[]'::jsonb,
  total numeric(12, 2) not null default 0,
  statut text not null default 'brouillon' check (statut in ('brouillon', 'emise', 'envoyee', 'payee', 'annulee')),
  emis_le date,
  echeance date,
  paye_le date,
  delai_jours integer not null default 30 check (delai_jours between 0 and 120),
  avoir_de uuid references public.invoices (id) on delete restrict,
  quote_id uuid references public.quotes (id) on delete set null,
  abonnement_id uuid,
  activite text not null default 'agence' check (activite in ('agence', 'ecomm')),
  pdf_path text,
  pdf_sha256 text,
  importee boolean not null default false,
  relances jsonb not null default '[]'::jsonb,
  -- prêt pour la facture électronique (Factur-X / plateforme agréée, phase ultérieure)
  facturx jsonb not null default '{}'::jsonb,
  notes text,
  cree_par text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
alter table public.invoices add column if not exists relances jsonb not null default '[]'::jsonb;
create index if not exists invoices_statut on public.invoices (statut, echeance);
create index if not exists invoices_emis on public.invoices (emis_le);

-- ------------------------------------------------------------------ paiements
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  montant numeric(12, 2) not null check (montant > 0),
  date date not null default current_date,
  moyen text not null default 'virement' check (moyen in ('virement', 'carte', 'especes', 'cheque', 'prelevement', 'autre')),
  note text,
  cree_par text,
  cree_le timestamptz not null default now()
);
create index if not exists payments_date on public.payments (date);

-- ------------------------------------------------------------------ abonnements clients (facturés le 1er du mois)
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  libelle text not null,
  lignes jsonb not null default '[]'::jsonb,
  montant numeric(12, 2) not null default 0,
  actif boolean not null default true,
  debut date not null default current_date,
  fin date,
  dernier_mois text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
alter table public.invoices drop constraint if exists invoices_abonnement_fk;
alter table public.invoices add constraint invoices_abonnement_fk foreign key (abonnement_id) references public.subscriptions (id) on delete set null;

-- ------------------------------------------------------------------ MJ E-comm (saisie manuelle, séparée de l'agence)
create table if not exists public.ecomm_months (
  mois text primary key check (mois ~ '^\d{4}-\d{2}$'),
  ca numeric(12, 2) not null default 0,
  cout_marchandises numeric(12, 2) not null default 0,
  depenses_pub numeric(12, 2) not null default 0,
  autres_frais numeric(12, 2) not null default 0,
  note text,
  maj_le timestamptz not null default now()
);

-- ------------------------------------------------------------------ réglages finance
alter table public.settings
  add column if not exists finance jsonb not null default
  '{"objectif_mensuel": 6000, "taux_cotisations": 0.246, "periodicite": "mensuelle", "seuil_tva": 37500, "seuil_tva_majore": 41250, "delai_paiement": 30, "validite_devis": 30, "iban": ""}'::jsonb;

-- ------------------------------------------------------------------ totaux calculés en base
create or replace function public.lignes_total(p jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(round(sum((coalesce((l ->> 'quantite')::numeric, 0)) * (coalesce((l ->> 'prix_unitaire')::numeric, 0))), 2), 0)
  from jsonb_array_elements(coalesce(p, '[]'::jsonb)) as l;
$$;

create or replace function public.finance_totaux()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.lignes is distinct from old.lignes then
    new.total := public.lignes_total(new.lignes);
  end if;
  new.maj_le := now();
  return new;
end;
$$;

-- ------------------------------------------------------------------ verrouillage légal
create or replace function public.invoices_verrou()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.statut <> 'brouillon' then
      raise exception 'Une facture émise ne peut pas être supprimée : fais un avoir.';
    end if;
    return old;
  end if;
  if old.statut <> 'brouillon' and not old.importee then
    if new.numero is distinct from old.numero or new.lignes is distinct from old.lignes or new.total is distinct from old.total
      or new.client_snapshot is distinct from old.client_snapshot or new.emis_le is distinct from old.emis_le
      or new.echeance is distinct from old.echeance or new.type is distinct from old.type or new.client_id is distinct from old.client_id
      or new.objet is distinct from old.objet or new.avoir_de is distinct from old.avoir_de then
      raise exception 'Facture % verrouillée : seule une correction par avoir est possible.', old.numero;
    end if;
    if new.pdf_path is distinct from old.pdf_path and old.pdf_path is not null then
      raise exception 'Le PDF archivé de la facture % ne peut pas être remplacé.', old.numero;
    end if;
    if new.statut = 'brouillon' then
      raise exception 'Une facture émise ne revient pas en brouillon.';
    end if;
  end if;
  if old.statut = 'brouillon' and new.statut <> 'brouillon' and new.numero is null and not new.importee then
    raise exception 'Une facture ne peut être émise que par public.emettre_facture (numérotation).';
  end if;
  return new;
end;
$$;

create or replace function public.quotes_verrou()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.statut <> 'brouillon' then
      raise exception 'Un devis émis ne peut pas être supprimé.';
    end if;
    return old;
  end if;
  if old.statut <> 'brouillon' then
    if new.numero is distinct from old.numero or new.lignes is distinct from old.lignes or new.total is distinct from old.total
      or new.client_snapshot is distinct from old.client_snapshot or new.emis_le is distinct from old.emis_le or new.objet is distinct from old.objet then
      raise exception 'Devis % verrouillé : crée un nouveau devis.', old.numero;
    end if;
    if new.statut = 'brouillon' then
      raise exception 'Un devis émis ne revient pas en brouillon.';
    end if;
  end if;
  if old.statut = 'brouillon' and new.statut <> 'brouillon' and new.numero is null then
    raise exception 'Un devis ne peut être émis que par public.emettre_devis (numérotation).';
  end if;
  return new;
end;
$$;

-- une pièce naît toujours en brouillon (sauf reprise de l'existant) : seul l'émetteur attribue un numéro
create or replace function public.pieces_naissance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'invoices' then
    if (new.statut <> 'brouillon' or new.numero is not null) and not new.importee then
      raise exception 'Une facture se crée en brouillon puis s''émet (numérotation automatique).';
    end if;
  elsif new.statut <> 'brouillon' or new.numero is not null then
    raise exception 'Un devis se crée en brouillon puis s''émet (numérotation automatique).';
  end if;
  return new;
end;
$$;
drop trigger if exists invoices_naissance on public.invoices;
create trigger invoices_naissance before insert on public.invoices for each row execute function public.pieces_naissance();
drop trigger if exists quotes_naissance on public.quotes;
create trigger quotes_naissance before insert on public.quotes for each row execute function public.pieces_naissance();

drop trigger if exists invoices_totaux on public.invoices;
create trigger invoices_totaux before insert or update on public.invoices for each row execute function public.finance_totaux();
drop trigger if exists invoices_verrou on public.invoices;
create trigger invoices_verrou before update or delete on public.invoices for each row execute function public.invoices_verrou();
drop trigger if exists quotes_totaux on public.quotes;
create trigger quotes_totaux before insert or update on public.quotes for each row execute function public.finance_totaux();
drop trigger if exists quotes_verrou on public.quotes;
create trigger quotes_verrou before update or delete on public.quotes for each row execute function public.quotes_verrou();
drop trigger if exists subscriptions_totaux on public.subscriptions;
create or replace function public.subscriptions_total()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.montant := public.lignes_total(new.lignes);
  new.maj_le := now();
  return new;
end;
$$;
create trigger subscriptions_totaux before insert or update on public.subscriptions for each row execute function public.subscriptions_total();

create or replace function public.paiements_interdits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Un paiement enregistré ne se modifie pas et ne se supprime pas (livre des recettes).';
end;
$$;
drop trigger if exists payments_fige on public.payments;
create trigger payments_fige before update or delete on public.payments for each row execute function public.paiements_interdits();

-- ------------------------------------------------------------------ émission (attribue le numéro, fige le client)
create or replace function public.client_fige(p_client uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('nom', c.nom, 'contact', c.contact, 'email', c.email, 'adresse', c.adresse, 'code_postal', c.code_postal,
    'ville', c.ville, 'siret', c.siret, 'type', c.type)
  from public.clients c where c.id = p_client;
$$;

create or replace function public.emettre_facture(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.invoices;
  num text;
begin
  select * into f from public.invoices where id = p_id for update;
  if not found then raise exception 'Facture introuvable.'; end if;
  if f.statut <> 'brouillon' then return f.numero; end if;
  if f.client_id is null then raise exception 'Choisis un client avant d''émettre.'; end if;
  if jsonb_array_length(f.lignes) = 0 then raise exception 'La facture n''a aucune ligne.'; end if;
  num := public.prochain_numero(case when f.type = 'avoir' then 'A' else 'F' end, extract(year from current_date)::int);
  update public.invoices set
    numero = num,
    statut = 'emise',
    emis_le = current_date,
    echeance = case when f.type = 'avoir' then null else current_date + f.delai_jours end,
    client_snapshot = public.client_fige(f.client_id)
  where id = p_id;
  return num;
end;
$$;

create or replace function public.emettre_devis(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.quotes;
  num text;
  validite integer;
begin
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

-- avoir : copie négative de la facture (totale ou partielle), émis aussitôt
create or replace function public.creer_avoir(p_facture uuid, p_motif text, p_lignes jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.invoices;
  nid uuid;
  l jsonb;
begin
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

-- paiement → facture payée quand le total est atteint
create or replace function public.paiement_statut()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.invoices;
  regle numeric;
begin
  select * into f from public.invoices where id = new.invoice_id;
  if f.statut = 'brouillon' then raise exception 'Émets la facture avant d''enregistrer un paiement.'; end if;
  select coalesce(sum(montant), 0) into regle from public.payments where invoice_id = new.invoice_id;
  if regle >= f.total and f.statut in ('emise', 'envoyee') then
    update public.invoices set statut = 'payee', paye_le = new.date where id = new.invoice_id;
  end if;
  return new;
end;
$$;
drop trigger if exists payments_statut on public.payments;
create trigger payments_statut after insert on public.payments for each row execute function public.paiement_statut();

revoke all on function public.emettre_facture(uuid) from public, anon;
revoke all on function public.emettre_devis(uuid) from public, anon;
revoke all on function public.creer_avoir(uuid, text, jsonb) from public, anon;
grant execute on function public.emettre_facture(uuid) to authenticated, service_role;
grant execute on function public.emettre_devis(uuid) to authenticated, service_role;
grant execute on function public.creer_avoir(uuid, text, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------------ livre des recettes (micro-entreprise)
create or replace view public.livre_recettes with (security_invoker = true) as
select p.date as date_encaissement, i.numero as piece, coalesce(i.client_snapshot ->> 'nom', c.nom) as client,
  i.objet as nature, p.montant, p.moyen as mode_reglement, i.activite, p.id as paiement_id, i.id as facture_id
from public.payments p
join public.invoices i on i.id = p.invoice_id
left join public.clients c on c.id = i.client_id;

-- ------------------------------------------------------------------ sécurité (fondateurs uniquement) + temps réel
do $$
declare t text;
begin
  foreach t in array array['clients', 'quotes', 'invoices', 'payments', 'subscriptions', 'ecomm_months'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists acces_fondateurs on public.%I', t);
    execute format('create policy acces_fondateurs on public.%I for all to authenticated using (public.is_allowed()) with check (public.is_allowed())', t);
  end loop;
end $$;
alter table public.numerotation enable row level security;
revoke all on public.numerotation from anon, authenticated;

-- ------------------------------------------------------------------ routines finance (sans IA)
insert into public.routines (id, nom, agent_id, mode, heure, jours, jour_du_mois, prompt_tache, actif) values
  ('rt_abonnements', 'Factures des abonnements', 'bastien', 'fixe', '08:00', '{}', 1, 'Prépare la facture de chaque abonnement actif du mois (envoi après validation en Douane).', true),
  ('rt_fiscal', 'Échéances fiscales', 'agathe', 'fixe', '08:05', '{}', null, 'Préviens 7 jours avant chaque échéance fiscale et au passage des seuils de TVA.', true)
on conflict (id) do nothing;
update public.agents set outils = array_append(outils, 'send_document') where id in ('bastien', 'victor') and not ('send_document' = any(outils));
update public.agents set outils = array_append(outils, 'create_invoice') where id = 'bastien' and not ('create_invoice' = any(outils));
