-- =====================================================================
-- Arkio · Cierra el acceso por API (/rest/v1/rpc) a funciones internas.
-- Recomendación del asesor de seguridad de Supabase (lints 0028 y 0029).
-- =====================================================================

-- Funciones de trigger: solo las ejecuta la base de datos, nunca un cliente.
revoke execute on function public.add_workspace_owner()   from public, anon, authenticated;
revoke execute on function public.create_default_board()  from public, anon, authenticated;
revoke execute on function public.handle_new_user()       from public, anon, authenticated;
revoke execute on function public.log_activity()          from public, anon, authenticated;

-- Funciones que usan las políticas RLS: los usuarios con sesión las necesitan
-- (solo responden sobre su propia membresía); los anónimos no.
revoke execute on function public.is_workspace_member(uuid) from public, anon;
revoke execute on function public.is_workspace_admin(uuid)  from public, anon;
revoke execute on function public.is_project_member(uuid)   from public, anon;
revoke execute on function public.can_edit_project(uuid)    from public, anon;
