-- LE PORT — Supabase accorde par défaut EXECUTE au rôle anon sur les fonctions du schéma public.
-- is_allowed() renvoie false sans session, mais on ferme quand même l'accès anonyme (lint 0028).
revoke execute on function public.is_allowed() from anon;
