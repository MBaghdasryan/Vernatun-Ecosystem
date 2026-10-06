--
-- PostgreSQL database dump
--

\restrict pxXqbjWte3PfjrjIu4KhPYXtGGuzdQvnl2p0gKn5KI0nN5ZVtZbdQGja5ie3faH

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: immutable_invoice_line(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.immutable_invoice_line() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN IF EXISTS(SELECT 1 FROM invoices WHERE id=COALESCE(NEW.invoice_id,OLD.invoice_id) AND status='published') OR (TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM invoices WHERE id=OLD.invoice_id AND status='published')) THEN RAISE EXCEPTION 'Published invoice lines are immutable'; END IF; IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;


--
-- Name: immutable_ledger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.immutable_ledger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN RAISE EXCEPTION 'Ledger entries are append-only'; END $$;


--
-- Name: immutable_published_invoice(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.immutable_published_invoice() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF OLD.status='published' THEN RAISE EXCEPTION 'Published invoices are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;


--
-- Name: notify_request_transition(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_request_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN INSERT INTO notifications(user_id,organization_id,kind,entity_id) SELECT r.author_user_id,r.organization_id,'request.'||NEW.action,NEW.request_id FROM resident_requests r WHERE r.id=NEW.request_id AND r.author_user_id<>NEW.actor_id; RETURN NEW; END $$;


--
-- Name: protect_request_history(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_request_history() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 RAISE EXCEPTION 'Request history is append-only' USING ERRCODE = '23514';
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: access_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.access_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pass_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    direction text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT access_events_direction_check CHECK ((direction = ANY (ARRAY['entry'::text, 'exit'::text])))
);


--
-- Name: adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    amount_minor bigint NOT NULL,
    reason text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT adjustments_amount_minor_check CHECK ((amount_minor <> 0))
);


--
-- Name: agenda_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agenda_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid NOT NULL,
    title text NOT NULL
);


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    building_id uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    published boolean DEFAULT false NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    building_id uuid NOT NULL,
    name text NOT NULL,
    serial_number text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    actor_user_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: auth_rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_rate_limits (
    key text NOT NULL,
    hits integer NOT NULL,
    reset_at timestamp with time zone NOT NULL
);


--
-- Name: budgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budgets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    building_id uuid NOT NULL,
    period date NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL,
    created_by uuid NOT NULL,
    CONSTRAINT budgets_amount_minor_check CHECK ((amount_minor >= 0)),
    CONSTRAINT budgets_currency_check CHECK ((currency = ANY (ARRAY['AMD'::text, 'RUB'::text, 'USD'::text])))
);


--
-- Name: buildings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buildings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    address text NOT NULL,
    is_demo boolean DEFAULT false NOT NULL
);


--
-- Name: charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    payer_assignment_id uuid NOT NULL,
    period date NOT NULL,
    tariff_id uuid NOT NULL,
    invoice_id uuid NOT NULL
);


--
-- Name: defect_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.defect_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    defect_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    action text NOT NULL,
    note text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: defects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.defects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    subject text NOT NULL,
    location text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    contractor_id uuid NOT NULL,
    due_on date NOT NULL,
    status text DEFAULT 'assigned'::text NOT NULL,
    report text DEFAULT ''::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT defects_status_check CHECK ((status = ANY (ARRAY['assigned'::text, 'in_progress'::text, 'review'::text, 'accepted'::text])))
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    building_id uuid NOT NULL,
    unit_id uuid,
    title text NOT NULL,
    visibility text NOT NULL,
    storage_key text NOT NULL,
    media_type text NOT NULL,
    uploaded_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT documents_check CHECK (((visibility <> 'unit_owner'::text) OR (unit_id IS NOT NULL))),
    CONSTRAINT documents_visibility_check CHECK ((visibility = ANY (ARRAY['staff'::text, 'residents'::text, 'unit_owner'::text])))
);


--
-- Name: entrances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entrances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    building_id uuid NOT NULL,
    name text NOT NULL
);


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    building_id uuid NOT NULL,
    description text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL,
    created_by uuid NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    CONSTRAINT expenses_amount_minor_check CHECK ((amount_minor > 0)),
    CONSTRAINT expenses_check CHECK (((approved_by IS NULL) OR (approved_by <> created_by))),
    CONSTRAINT expenses_currency_check CHECK ((currency = ANY (ARRAY['AMD'::text, 'RUB'::text, 'USD'::text])))
);


--
-- Name: file_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.file_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    defect_id uuid NOT NULL,
    author_id uuid NOT NULL,
    storage_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: floors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.floors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    building_id uuid NOT NULL,
    entrance_id uuid NOT NULL,
    number integer NOT NULL
);


--
-- Name: handover_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.handover_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    status text DEFAULT 'inspection'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT handover_cases_status_check CHECK ((status = ANY (ARRAY['inspection'::text, 'ready'::text, 'operational'::text])))
);


--
-- Name: import_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    building_id uuid NOT NULL,
    created_by uuid NOT NULL,
    rows jsonb NOT NULL,
    errors jsonb NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    committed_at timestamp with time zone,
    CONSTRAINT import_jobs_status_check CHECK ((status = ANY (ARRAY['invalid'::text, 'preview'::text, 'committed'::text])))
);


--
-- Name: incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    building_id uuid NOT NULL,
    created_by uuid NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inspections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    handover_id uuid NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    checklist jsonb NOT NULL,
    report text DEFAULT ''::text NOT NULL,
    completed_at timestamp with time zone,
    completed_by uuid
);


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    email text NOT NULL,
    role_key text NOT NULL,
    building_id uuid,
    unit_id uuid,
    token_hash text NOT NULL,
    invited_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    revoked_at timestamp with time zone,
    delegation_id uuid,
    CONSTRAINT invitations_check CHECK (((unit_id IS NULL) OR (building_id IS NOT NULL))),
    CONSTRAINT invitations_role_key_check CHECK ((role_key <> ALL (ARRAY['platform_admin'::text, 'support'::text])))
);


--
-- Name: invoice_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    description text NOT NULL,
    quantity_hundredths bigint NOT NULL,
    rate_minor bigint NOT NULL,
    amount_minor bigint NOT NULL,
    CONSTRAINT invoice_lines_amount_minor_check CHECK ((amount_minor > 0)),
    CONSTRAINT invoice_lines_quantity_hundredths_check CHECK ((quantity_hundredths > 0)),
    CONSTRAINT invoice_lines_rate_minor_check CHECK ((rate_minor > 0))
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    payer_user_id uuid NOT NULL,
    period date NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL,
    status text NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    created_by uuid,
    published_by uuid,
    published_at timestamp with time zone,
    CONSTRAINT invoices_amount_minor_check CHECK ((amount_minor >= 0)),
    CONSTRAINT invoices_currency_check CHECK ((currency = ANY (ARRAY['AMD'::text, 'RUB'::text, 'USD'::text]))),
    CONSTRAINT invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text])))
);


--
-- Name: leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    renter_id uuid NOT NULL,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL,
    created_by uuid NOT NULL,
    CONSTRAINT leases_amount_minor_check CHECK ((amount_minor >= 0)),
    CONSTRAINT leases_check CHECK ((ends_on >= starts_on)),
    CONSTRAINT leases_currency_check CHECK ((currency = ANY (ARRAY['AMD'::text, 'RUB'::text, 'USD'::text])))
);


--
-- Name: maintenance_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    title text NOT NULL,
    due_on date NOT NULL,
    completed_at timestamp with time zone,
    completed_by uuid,
    report text DEFAULT ''::text NOT NULL
);


--
-- Name: meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meetings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    building_id uuid NOT NULL,
    title text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    created_by uuid NOT NULL,
    CONSTRAINT meetings_check CHECK ((ends_at > starts_at))
);


--
-- Name: memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    active boolean DEFAULT true NOT NULL
);


--
-- Name: meter_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meter_readings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meter_id uuid NOT NULL,
    value_thousandths bigint NOT NULL,
    period date NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT meter_readings_value_thousandths_check CHECK ((value_thousandths >= 0))
);


--
-- Name: meters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    serial_number text NOT NULL,
    kind text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT meters_kind_check CHECK ((kind = ANY (ARRAY['water'::text, 'electricity'::text, 'gas'::text])))
);


--
-- Name: mfa_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mfa_credentials (
    user_id uuid NOT NULL,
    secret_encrypted text,
    pending_secret text,
    pending_until timestamp with time zone,
    enabled boolean DEFAULT false NOT NULL,
    last_counter bigint DEFAULT '-1'::integer NOT NULL,
    recovery_hashes text[] DEFAULT '{}'::text[] NOT NULL
);


--
-- Name: module_entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.module_entitlements (
    organization_id uuid NOT NULL,
    module text NOT NULL,
    enabled boolean DEFAULT true NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    kind text NOT NULL,
    entity_id uuid,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: occupancies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.occupancies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    user_id uuid NOT NULL,
    starts_on date NOT NULL,
    ends_on date,
    CONSTRAINT occupancies_check CHECK (((ends_on IS NULL) OR (ends_on >= starts_on)))
);


--
-- Name: onboarding_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    assigned_to uuid NOT NULL,
    title text NOT NULL,
    due_on date NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: operation_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operation_receipts (
    actor_id uuid NOT NULL,
    key uuid NOT NULL,
    fingerprint text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    timezone text DEFAULT 'Asia/Yerevan'::text NOT NULL,
    currency text DEFAULT 'AMD'::text NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    contact_email text DEFAULT ''::text NOT NULL,
    contact_phone text DEFAULT ''::text NOT NULL,
    brand_color text DEFAULT '#FF6B0A'::text NOT NULL,
    CONSTRAINT organizations_currency_check CHECK ((currency = ANY (ARRAY['AMD'::text, 'RUB'::text, 'USD'::text])))
);


--
-- Name: ownerships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ownerships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    user_id uuid NOT NULL,
    starts_on date NOT NULL,
    ends_on date,
    share_basis_points integer NOT NULL,
    CONSTRAINT ownerships_check CHECK (((ends_on IS NULL) OR (ends_on >= starts_on))),
    CONSTRAINT ownerships_share_basis_points_check CHECK (((share_basis_points >= 1) AND (share_basis_points <= 10000)))
);


--
-- Name: password_resets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_resets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone
);


--
-- Name: payer_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payer_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    payer_user_id uuid NOT NULL,
    service_id uuid NOT NULL,
    starts_on date NOT NULL,
    ends_on date,
    CONSTRAINT payer_assignments_check CHECK (((ends_on IS NULL) OR (ends_on >= starts_on)))
);


--
-- Name: payment_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    payment_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    amount_minor bigint NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_allocations_amount_minor_check CHECK ((amount_minor > 0))
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    payer_user_id uuid NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL,
    source text NOT NULL,
    reference text NOT NULL,
    confirmed_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payments_amount_minor_check CHECK ((amount_minor > 0)),
    CONSTRAINT payments_currency_check CHECK ((currency = ANY (ARRAY['AMD'::text, 'RUB'::text, 'USD'::text]))),
    CONSTRAINT payments_source_check CHECK ((source = ANY (ARRAY['manual_bank'::text, 'sandbox'::text])))
);


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    key text NOT NULL
);


--
-- Name: request_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    actor_role text NOT NULL,
    action text NOT NULL,
    from_status text,
    to_status text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: request_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    internal boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: request_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    author_id uuid NOT NULL,
    storage_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: resident_delegations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resident_delegations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    owner_assignment_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    permission_keys text[] NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    assignment_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: resident_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resident_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    author_user_id uuid NOT NULL,
    subject text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT resident_requests_status_check CHECK ((status = ANY (ARRAY['new'::text, 'assigned'::text, 'in_progress'::text, 'review'::text, 'closed'::text])))
);


--
-- Name: role_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid,
    role_key text NOT NULL,
    building_id uuid,
    unit_id uuid,
    active boolean DEFAULT true NOT NULL,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT role_assignments_check CHECK (((unit_id IS NULL) OR (building_id IS NOT NULL))),
    CONSTRAINT role_assignments_check1 CHECK (((organization_id IS NOT NULL) OR ((building_id IS NULL) AND (unit_id IS NULL) AND (role_key = ANY (ARRAY['platform_admin'::text, 'support'::text]))))),
    CONSTRAINT role_assignments_check2 CHECK (((organization_id IS NULL) OR (role_key <> ALL (ARRAY['platform_admin'::text, 'support'::text])))),
    CONSTRAINT role_assignments_check3 CHECK (((expires_at IS NULL) OR (expires_at > starts_at)))
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    role_key text NOT NULL,
    permission_key text NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    key text NOT NULL,
    shell text NOT NULL,
    CONSTRAINT roles_shell_check CHECK ((shell = ANY (ARRAY['platform'::text, 'workspace'::text, 'field'::text, 'home'::text])))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamp with time zone DEFAULT now()
);


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL
);


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


--
-- Name: subscription_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL,
    building_limit integer NOT NULL,
    CONSTRAINT subscription_plans_amount_minor_check CHECK ((amount_minor >= 0)),
    CONSTRAINT subscription_plans_building_limit_check CHECK ((building_limit > 0)),
    CONSTRAINT subscription_plans_currency_check CHECK ((currency = ANY (ARRAY['AMD'::text, 'RUB'::text, 'USD'::text])))
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid NOT NULL,
    CONSTRAINT subscriptions_check CHECK ((ends_on >= starts_on)),
    CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text])))
);


--
-- Name: support_access_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_access_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    support_user_id uuid NOT NULL,
    reason text NOT NULL,
    permission_keys text[] NOT NULL,
    requested_until timestamp with time zone NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_access_grants_check CHECK (((approved_by IS NULL) OR (approved_by <> support_user_id)))
);


--
-- Name: support_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    created_by uuid NOT NULL,
    assigned_to uuid,
    subject text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    reply text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_cases_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text])))
);


--
-- Name: tariffs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tariffs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    service_id uuid NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL,
    basis text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tariffs_amount_minor_check CHECK ((amount_minor > 0)),
    CONSTRAINT tariffs_basis_check CHECK ((basis = ANY (ARRAY['unit'::text, 'area'::text]))),
    CONSTRAINT tariffs_currency_check CHECK ((currency = ANY (ARRAY['AMD'::text, 'RUB'::text, 'USD'::text])))
);


--
-- Name: units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.units (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    building_id uuid NOT NULL,
    number text NOT NULL,
    area numeric(12,2) NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    CONSTRAINT units_area_check CHECK ((area > (0)::numeric))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    password_hash text NOT NULL,
    blocked boolean DEFAULT false NOT NULL,
    locale text DEFAULT 'hy'::text NOT NULL,
    currency text DEFAULT 'AMD'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_currency_check CHECK ((currency = ANY (ARRAY['AMD'::text, 'RUB'::text, 'USD'::text]))),
    CONSTRAINT users_locale_check CHECK ((locale = ANY (ARRAY['hy'::text, 'ru'::text, 'en'::text])))
);


--
-- Name: visitor_passes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visitor_passes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    created_by uuid NOT NULL,
    visitor text NOT NULL,
    vehicle text DEFAULT ''::text NOT NULL,
    token_hash text NOT NULL,
    valid_from timestamp with time zone NOT NULL,
    valid_until timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    state text DEFAULT 'expected'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT visitor_passes_check CHECK ((valid_until > valid_from)),
    CONSTRAINT visitor_passes_state_check CHECK ((state = ANY (ARRAY['expected'::text, 'inside'::text, 'exited'::text])))
);


--
-- Name: votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.votes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agenda_item_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    voter_id uuid NOT NULL,
    choice text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT votes_choice_check CHECK ((choice = ANY (ARRAY['yes'::text, 'no'::text, 'abstain'::text])))
);


--
-- Name: warranties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warranties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    description text NOT NULL,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    CONSTRAINT warranties_check CHECK ((ends_on >= starts_on))
);


--
-- Name: work_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    technician_id uuid NOT NULL,
    assigned_by uuid NOT NULL,
    status text DEFAULT 'assigned'::text NOT NULL,
    checklist jsonb DEFAULT '[]'::jsonb NOT NULL,
    report text DEFAULT ''::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT work_orders_status_check CHECK ((status = ANY (ARRAY['assigned'::text, 'in_progress'::text, 'review'::text, 'resident_review'::text, 'closed'::text])))
);


--
-- Name: work_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    work_order_id uuid NOT NULL,
    reporter_id uuid NOT NULL,
    body text NOT NULL,
    checklist jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Data for Name: adjustments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.adjustments (id, organization_id, invoice_id, amount_minor, reason, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: agenda_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.agenda_items (id, meeting_id, title) FROM stdin;
\.


--
-- Data for Name: announcements; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.announcements (id, organization_id, building_id, title, body, published, created_by, created_at) FROM stdin;
c2aa25ed-1d1d-49e2-aaf6-3e08eee4c985	ad59cf43-12af-4dd1-bb11-abfd4a096457	48209bba-884b-45fd-b3b3-0d2c1d7d8386	Demo · Տան նորություններ	Սա ցուցադրական հայտարարություն է։ Ծառայությունների փոփոխություններ չեն նախատեսվում։	t	1bf026a2-eaf2-4876-a8ba-54547d8faf74	2026-09-28 21:41:01.32189+00
\.


--
-- Data for Name: assets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.assets (id, organization_id, building_id, name, serial_number, created_at) FROM stdin;
ed537243-8a6f-4fd7-90d6-f402e5ca179e	ad59cf43-12af-4dd1-bb11-abfd4a096457	48209bba-884b-45fd-b3b3-0d2c1d7d8386	Demo · Վերելակ	DEMO-LIFT-01	2026-09-28 21:41:01.32189+00
\.


--
-- Data for Name: audit_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, details, created_at) FROM stdin;
e62da20f-ed56-4209-839b-78591dce1704	\N	059cedfb-5910-42bc-ad30-3c370f2afd3c	demo.seed	system	\N	{"demo": true}	2026-09-27 21:38:44.336042+00
dc9faaa3-2d6d-4c18-acfc-7bfb7e4be288	\N	059cedfb-5910-42bc-ad30-3c370f2afd3c	auth.login	user	059cedfb-5910-42bc-ad30-3c370f2afd3c	{}	2026-09-27 21:45:19.91469+00
b8416f07-6728-40c2-94c0-a6c04709dfef	\N	059cedfb-5910-42bc-ad30-3c370f2afd3c	auth.login	user	059cedfb-5910-42bc-ad30-3c370f2afd3c	{}	2026-09-28 05:24:19.060531+00
73f15ca0-29e0-4f8c-9fa8-5b3f56e1f156	\N	9bcbebb1-868c-4d51-b712-08d5a29f7995	auth.login	user	9bcbebb1-868c-4d51-b712-08d5a29f7995	{}	2026-09-28 05:24:23.685662+00
e07af003-f0c7-49cc-b7f2-b87d515e460e	ad59cf43-12af-4dd1-bb11-abfd4a096457	9bcbebb1-868c-4d51-b712-08d5a29f7995	auth.context	role_assignment	65c2b9ac-a00f-46cc-8095-92a3be542fe6	{}	2026-09-28 05:24:23.989484+00
7fa1c8ef-c00b-426c-9dd9-1d2198437b5f	\N	6f5cdb59-40f2-4e08-b401-3cf9c97605fb	auth.login	user	6f5cdb59-40f2-4e08-b401-3cf9c97605fb	{}	2026-09-28 05:24:26.744487+00
b7465c7c-238a-4dbf-9b15-81003022e1b4	\N	71184895-f4d1-46e8-8928-d3963e959ceb	auth.login	user	71184895-f4d1-46e8-8928-d3963e959ceb	{}	2026-09-28 05:24:29.387989+00
a3db51a2-42c6-4ca7-b372-c276362c0571	\N	2bd80cc6-e888-4554-987f-d7633f01f081	auth.login	user	2bd80cc6-e888-4554-987f-d7633f01f081	{}	2026-09-28 05:24:31.693847+00
7211d0b2-0cbd-44e0-a986-2946a4cb6202	\N	872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	auth.login	user	872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	{}	2026-09-28 05:24:34.07273+00
02b9685b-531e-43dc-92ac-4902c0f573f4	\N	1b68760e-8a44-4fd0-bb21-810a80123cd6	auth.login	user	1b68760e-8a44-4fd0-bb21-810a80123cd6	{}	2026-09-28 05:24:36.42741+00
08e0f201-ebb1-4846-8ad1-ea7ab1e7b84d	\N	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	auth.login	user	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	{}	2026-09-28 08:27:55.241805+00
1fb4f39a-dc41-438e-98a8-3fbb082f6853	\N	c987c188-8757-40a1-a07e-239c1e63cba3	auth.login	user	c987c188-8757-40a1-a07e-239c1e63cba3	{}	2026-09-28 08:27:58.657997+00
1bcba074-fa5e-4425-be22-2d3947f00f50	\N	2bd80cc6-e888-4554-987f-d7633f01f081	auth.login	user	2bd80cc6-e888-4554-987f-d7633f01f081	{}	2026-09-28 08:28:01.853152+00
b2367e13-79ed-4d4e-b96c-9147fd5dbadf	\N	1bf026a2-eaf2-4876-a8ba-54547d8faf74	auth.login	user	1bf026a2-eaf2-4876-a8ba-54547d8faf74	{}	2026-09-28 08:28:05.831991+00
874d6b17-5249-4063-993b-304572c9b1e9	ad59cf43-12af-4dd1-bb11-abfd4a096457	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	request.create	resident_request	3cf28444-9237-4d75-bf20-a365b146febe	{"to": "new", "from": "new"}	2026-09-28 08:28:06.27628+00
ac811f2c-d15d-474c-a694-1f53299e0f38	ad59cf43-12af-4dd1-bb11-abfd4a096457	c987c188-8757-40a1-a07e-239c1e63cba3	request.assign	resident_request	3cf28444-9237-4d75-bf20-a365b146febe	{"to": "assigned", "from": "new"}	2026-09-28 08:28:06.824207+00
c9b94042-51e1-4145-86dd-188b7507026b	ad59cf43-12af-4dd1-bb11-abfd4a096457	2bd80cc6-e888-4554-987f-d7633f01f081	request.start	resident_request	3cf28444-9237-4d75-bf20-a365b146febe	{"to": "in_progress", "from": "assigned"}	2026-09-28 08:28:07.352976+00
f71ae510-c316-406f-b1b1-bf90606d4580	ad59cf43-12af-4dd1-bb11-abfd4a096457	2bd80cc6-e888-4554-987f-d7633f01f081	request.report	resident_request	3cf28444-9237-4d75-bf20-a365b146febe	{"to": "review", "from": "in_progress"}	2026-09-28 08:28:07.652728+00
b6556ad3-8f4f-4ea0-ad54-c05f85953d2c	ad59cf43-12af-4dd1-bb11-abfd4a096457	1bf026a2-eaf2-4876-a8ba-54547d8faf74	request.approve	resident_request	3cf28444-9237-4d75-bf20-a365b146febe	{"to": "resident_review", "from": "review"}	2026-09-28 08:28:08.20467+00
27087f75-2408-4e18-9c36-871220a0d1ef	ad59cf43-12af-4dd1-bb11-abfd4a096457	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	request.confirm	resident_request	3cf28444-9237-4d75-bf20-a365b146febe	{"to": "closed", "from": "review"}	2026-09-28 08:28:08.778824+00
c55fd71d-2245-40ae-9619-796b5fca6d04	\N	059cedfb-5910-42bc-ad30-3c370f2afd3c	auth.login	user	059cedfb-5910-42bc-ad30-3c370f2afd3c	{}	2026-09-28 08:53:39.616572+00
8e979003-0688-4e35-b2bc-c9033d024f3f	\N	059cedfb-5910-42bc-ad30-3c370f2afd3c	auth.context	role_assignment	9b90d564-ea54-4a6d-8f8f-1fa044d33262	{}	2026-09-28 08:54:07.535539+00
4e6b2894-6a5a-4ff3-8b58-44b179b5040d	\N	059cedfb-5910-42bc-ad30-3c370f2afd3c	auth.context	role_assignment	9b90d564-ea54-4a6d-8f8f-1fa044d33262	{}	2026-09-28 08:54:20.931635+00
b607abca-df18-4bff-9a3e-2f2f4aea4395	\N	9bcbebb1-868c-4d51-b712-08d5a29f7995	auth.login	user	9bcbebb1-868c-4d51-b712-08d5a29f7995	{}	2026-09-28 08:55:17.922453+00
5faf1430-c7ba-4de5-a0a6-d65fb97b8a24	ad59cf43-12af-4dd1-bb11-abfd4a096457	9bcbebb1-868c-4d51-b712-08d5a29f7995	auth.context	role_assignment	65c2b9ac-a00f-46cc-8095-92a3be542fe6	{}	2026-09-28 08:55:28.514457+00
a18c85d0-6be4-4a2d-9742-4995d1c35c2b	\N	059cedfb-5910-42bc-ad30-3c370f2afd3c	auth.login	user	059cedfb-5910-42bc-ad30-3c370f2afd3c	{}	2026-09-28 10:48:20.582842+00
8c37b577-295c-411f-83cd-1027512ff58f	\N	6b9accbd-a053-46de-8c7a-5fac7a9ebd96	auth.login	user	6b9accbd-a053-46de-8c7a-5fac7a9ebd96	{}	2026-09-28 10:48:28.013511+00
b6980ff4-e7dc-4c1f-8546-81b224f76ca5	\N	9bcbebb1-868c-4d51-b712-08d5a29f7995	auth.login	user	9bcbebb1-868c-4d51-b712-08d5a29f7995	{}	2026-09-28 10:48:35.313394+00
a2491212-6af4-4dfb-bf26-4124647aacf6	ad59cf43-12af-4dd1-bb11-abfd4a096457	9bcbebb1-868c-4d51-b712-08d5a29f7995	auth.context	role_assignment	f226a100-c197-4a05-900f-6c2c8135ab55	{}	2026-09-28 10:48:35.628093+00
835dae42-1332-4aa4-96fc-73a3e05e0fbc	\N	2b2502e9-be78-4d2b-a74b-c65b28faad22	auth.login	user	2b2502e9-be78-4d2b-a74b-c65b28faad22	{}	2026-09-28 10:48:43.893883+00
71328095-8a0a-45fc-9dec-e9369857b5ce	\N	10fc53b7-d4af-4f43-ab65-0f5ecfc4540d	auth.login	user	10fc53b7-d4af-4f43-ab65-0f5ecfc4540d	{}	2026-09-28 10:48:48.237737+00
dacf769b-e53e-4234-a847-6333dae5a75a	\N	1bf026a2-eaf2-4876-a8ba-54547d8faf74	auth.login	user	1bf026a2-eaf2-4876-a8ba-54547d8faf74	{}	2026-09-28 10:48:52.499161+00
9d470351-8f36-4d75-a010-f033dd6c919c	\N	5d897d84-8ec8-4942-9cb3-6ca1a84f569f	auth.login	user	5d897d84-8ec8-4942-9cb3-6ca1a84f569f	{}	2026-09-28 10:48:57.849622+00
0df4c67e-153c-453f-80e5-7b671780d528	\N	c987c188-8757-40a1-a07e-239c1e63cba3	auth.login	user	c987c188-8757-40a1-a07e-239c1e63cba3	{}	2026-09-28 10:49:02.484349+00
9f8a64f3-7fd3-4c05-9066-8e6aaa5faae2	\N	2bd80cc6-e888-4554-987f-d7633f01f081	auth.login	user	2bd80cc6-e888-4554-987f-d7633f01f081	{}	2026-09-28 10:49:06.387294+00
10d3cd0c-f0a6-40c5-846e-8d090932bbd9	\N	872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	auth.login	user	872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	{}	2026-09-28 10:49:10.061765+00
ce6772da-33da-4421-abb6-6c500fee62c1	\N	1b68760e-8a44-4fd0-bb21-810a80123cd6	auth.login	user	1b68760e-8a44-4fd0-bb21-810a80123cd6	{}	2026-09-28 10:49:13.89026+00
a9b2ee69-646d-4292-a09d-881bf02fc3bf	\N	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	auth.login	user	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	{}	2026-09-28 10:49:17.689811+00
bd3ba0b3-6c2c-4f67-a5a3-3124437cc39a	\N	71184895-f4d1-46e8-8928-d3963e959ceb	auth.login	user	71184895-f4d1-46e8-8928-d3963e959ceb	{}	2026-09-28 10:49:23.131071+00
5f07c1d1-4cbc-4d21-aabb-7c3b5aebdb9e	\N	6f5cdb59-40f2-4e08-b401-3cf9c97605fb	auth.login	user	6f5cdb59-40f2-4e08-b401-3cf9c97605fb	{}	2026-09-28 10:49:30.398794+00
8d1098b5-cf4f-439b-ba62-441b52ef616b	\N	09f2e5ec-5652-4c62-98b7-2adb18038ec1	auth.login	user	09f2e5ec-5652-4c62-98b7-2adb18038ec1	{}	2026-09-28 10:49:37.919178+00
2462738e-ae41-460c-8267-0c2b4dae5b99	\N	059cedfb-5910-42bc-ad30-3c370f2afd3c	auth.login	user	059cedfb-5910-42bc-ad30-3c370f2afd3c	{}	2026-09-28 21:39:29.592981+00
e24c590c-79a4-4002-a0ff-e94d01dda7ec	\N	059cedfb-5910-42bc-ad30-3c370f2afd3c	auth.context	role_assignment	9b90d564-ea54-4a6d-8f8f-1fa044d33262	{}	2026-09-28 21:40:21.982102+00
65e2fa28-29dd-4d99-90ae-94cc7fefab57	\N	059cedfb-5910-42bc-ad30-3c370f2afd3c	demo.modules.seed	system	\N	{"demo": true}	2026-09-28 21:41:01.32189+00
b5ed8065-3bc4-466a-bdab-af85401711e6	\N	059cedfb-5910-42bc-ad30-3c370f2afd3c	auth.login	user	059cedfb-5910-42bc-ad30-3c370f2afd3c	{}	2026-09-28 21:42:33.874706+00
11ce4a37-ab48-4d29-9570-071aa89fd7e3	\N	6b9accbd-a053-46de-8c7a-5fac7a9ebd96	auth.login	user	6b9accbd-a053-46de-8c7a-5fac7a9ebd96	{}	2026-09-28 21:42:39.005289+00
b587014e-a257-47c4-ac04-96dfc3ccef71	\N	9bcbebb1-868c-4d51-b712-08d5a29f7995	auth.login	user	9bcbebb1-868c-4d51-b712-08d5a29f7995	{}	2026-09-28 21:42:43.47462+00
1f3c8683-48bc-4c01-bd67-43a6ef4f29c3	ad59cf43-12af-4dd1-bb11-abfd4a096457	9bcbebb1-868c-4d51-b712-08d5a29f7995	auth.context	role_assignment	f226a100-c197-4a05-900f-6c2c8135ab55	{}	2026-09-28 21:42:43.751607+00
d60d2b4d-c7a5-4421-bb1b-e35714d5466e	\N	2b2502e9-be78-4d2b-a74b-c65b28faad22	auth.login	user	2b2502e9-be78-4d2b-a74b-c65b28faad22	{}	2026-09-28 21:42:50.069363+00
17784948-de26-495e-a0fa-7f041c0bc050	\N	10fc53b7-d4af-4f43-ab65-0f5ecfc4540d	auth.login	user	10fc53b7-d4af-4f43-ab65-0f5ecfc4540d	{}	2026-09-28 21:42:55.450923+00
f79c13a6-3c7b-4c62-9033-a8d075988a90	\N	1bf026a2-eaf2-4876-a8ba-54547d8faf74	auth.login	user	1bf026a2-eaf2-4876-a8ba-54547d8faf74	{}	2026-09-28 21:43:01.237212+00
e0849acd-1833-4898-bcce-4a2f32693c4d	\N	5d897d84-8ec8-4942-9cb3-6ca1a84f569f	auth.login	user	5d897d84-8ec8-4942-9cb3-6ca1a84f569f	{}	2026-09-28 21:43:07.383979+00
50e87943-ed35-4ef0-8bf1-f1ffef2a193f	\N	c987c188-8757-40a1-a07e-239c1e63cba3	auth.login	user	c987c188-8757-40a1-a07e-239c1e63cba3	{}	2026-09-28 21:43:12.342816+00
00b97227-fc9b-46bb-8837-a367cde76dd2	\N	2bd80cc6-e888-4554-987f-d7633f01f081	auth.login	user	2bd80cc6-e888-4554-987f-d7633f01f081	{}	2026-09-28 21:43:16.66834+00
8372beb4-9e05-4719-8298-901b769a1d80	\N	872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	auth.login	user	872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	{}	2026-09-28 21:43:20.743586+00
084c0f07-6d69-45d7-bbaf-b47d18b6fd24	\N	1b68760e-8a44-4fd0-bb21-810a80123cd6	auth.login	user	1b68760e-8a44-4fd0-bb21-810a80123cd6	{}	2026-09-28 21:43:24.972894+00
7c18a220-7965-4211-ab68-c036420c0ce3	\N	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	auth.login	user	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	{}	2026-09-28 21:43:29.520944+00
0790e47a-f828-4ed7-99b9-df5905fc2079	\N	71184895-f4d1-46e8-8928-d3963e959ceb	auth.login	user	71184895-f4d1-46e8-8928-d3963e959ceb	{}	2026-09-28 21:43:36.637057+00
799e0b34-84ee-4584-853f-95fe4a7c9c56	\N	6f5cdb59-40f2-4e08-b401-3cf9c97605fb	auth.login	user	6f5cdb59-40f2-4e08-b401-3cf9c97605fb	{}	2026-09-28 21:43:42.345947+00
660a2dde-3b78-44bf-a027-e61fe218baa4	\N	09f2e5ec-5652-4c62-98b7-2adb18038ec1	auth.login	user	09f2e5ec-5652-4c62-98b7-2adb18038ec1	{}	2026-09-28 21:43:47.734385+00
18e1e37d-554f-4d3c-bb3e-39db663718e2	\N	10fc53b7-d4af-4f43-ab65-0f5ecfc4540d	auth.login	user	10fc53b7-d4af-4f43-ab65-0f5ecfc4540d	{}	2026-09-28 21:56:05.630839+00
3a39a0ed-bce4-44ac-87d2-f1019cc8369a	\N	6b9accbd-a053-46de-8c7a-5fac7a9ebd96	auth.login	user	6b9accbd-a053-46de-8c7a-5fac7a9ebd96	{}	2026-09-28 21:56:47.335368+00
d3727fb6-dc22-4ecf-bf02-183f956f0d82	\N	71184895-f4d1-46e8-8928-d3963e959ceb	auth.login	user	71184895-f4d1-46e8-8928-d3963e959ceb	{}	2026-09-28 21:57:25.246626+00
75ce1221-6aff-4cdd-b19a-fe5198249a94	\N	059cedfb-5910-42bc-ad30-3c370f2afd3c	auth.login	user	059cedfb-5910-42bc-ad30-3c370f2afd3c	{}	2026-09-29 13:00:39.086638+00
307785de-a6c7-434b-9587-79d7b14a5efc	\N	6b9accbd-a053-46de-8c7a-5fac7a9ebd96	auth.login	user	6b9accbd-a053-46de-8c7a-5fac7a9ebd96	{}	2026-09-29 13:00:45.83122+00
a515e308-cd4c-424b-a203-f781db010ece	\N	059cedfb-5910-42bc-ad30-3c370f2afd3c	auth.login	user	059cedfb-5910-42bc-ad30-3c370f2afd3c	{}	2026-09-29 13:01:54.326831+00
5369e852-f8e4-4c4c-8ae2-038ccfbd12bd	\N	6b9accbd-a053-46de-8c7a-5fac7a9ebd96	auth.login	user	6b9accbd-a053-46de-8c7a-5fac7a9ebd96	{}	2026-09-29 13:02:00.955326+00
01940cf9-0ff6-48ee-81c9-e65c80f1ffdf	\N	9bcbebb1-868c-4d51-b712-08d5a29f7995	auth.login	user	9bcbebb1-868c-4d51-b712-08d5a29f7995	{}	2026-09-29 13:02:08.220252+00
baa64db7-fb90-4df8-9e8c-088d98765fff	ad59cf43-12af-4dd1-bb11-abfd4a096457	9bcbebb1-868c-4d51-b712-08d5a29f7995	auth.context	role_assignment	65c2b9ac-a00f-46cc-8095-92a3be542fe6	{}	2026-09-29 13:02:08.899572+00
d06287e1-ae25-47f2-8681-a846f8cee7d3	\N	2b2502e9-be78-4d2b-a74b-c65b28faad22	auth.login	user	2b2502e9-be78-4d2b-a74b-c65b28faad22	{}	2026-09-29 13:02:17.669384+00
c872a273-8f16-4123-9634-73062599f52f	\N	10fc53b7-d4af-4f43-ab65-0f5ecfc4540d	auth.login	user	10fc53b7-d4af-4f43-ab65-0f5ecfc4540d	{}	2026-09-29 13:02:24.708341+00
25e51415-d13a-45f5-b23e-05bba03e1d6d	\N	5d897d84-8ec8-4942-9cb3-6ca1a84f569f	auth.login	user	5d897d84-8ec8-4942-9cb3-6ca1a84f569f	{}	2026-09-29 13:02:31.543845+00
7cc0a544-d197-4d1a-b562-e9c0d3a51242	\N	1bf026a2-eaf2-4876-a8ba-54547d8faf74	auth.login	user	1bf026a2-eaf2-4876-a8ba-54547d8faf74	{}	2026-09-29 13:02:38.667369+00
d5fb4e06-ea6a-4f3e-b9ee-07c013a8722f	ad59cf43-12af-4dd1-bb11-abfd4a096457	1bf026a2-eaf2-4876-a8ba-54547d8faf74	auth.context	role_assignment	d6618f4b-0b46-4b2b-acc6-bcabfba3708a	{}	2026-09-29 13:02:43.604543+00
61839445-e5ae-4fa9-973f-bf552e49752b	ad59cf43-12af-4dd1-bb11-abfd4a096457	1bf026a2-eaf2-4876-a8ba-54547d8faf74	auth.context	role_assignment	d6618f4b-0b46-4b2b-acc6-bcabfba3708a	{}	2026-09-29 13:02:44.019784+00
717ef95f-85e7-46d3-a7a1-a0f3625305d2	\N	c987c188-8757-40a1-a07e-239c1e63cba3	auth.login	user	c987c188-8757-40a1-a07e-239c1e63cba3	{}	2026-09-29 13:02:46.424077+00
a57e115d-aaa3-4f94-9faa-3e2243050761	\N	2bd80cc6-e888-4554-987f-d7633f01f081	auth.login	user	2bd80cc6-e888-4554-987f-d7633f01f081	{}	2026-09-29 13:02:53.04196+00
8def7b9c-e8d9-4e11-b4b0-1c78cc951092	\N	872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	auth.login	user	872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	{}	2026-09-29 13:02:59.543201+00
89d589eb-351d-4a54-af48-133e6bfde56e	\N	1b68760e-8a44-4fd0-bb21-810a80123cd6	auth.login	user	1b68760e-8a44-4fd0-bb21-810a80123cd6	{}	2026-09-29 13:03:05.925664+00
fca6c50f-9e4a-431a-b8e9-2e5d6cf2d613	\N	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	auth.login	user	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	{}	2026-09-29 13:03:12.524883+00
3cb86986-5d1a-480e-8111-22438d0fcde6	\N	71184895-f4d1-46e8-8928-d3963e959ceb	auth.login	user	71184895-f4d1-46e8-8928-d3963e959ceb	{}	2026-09-29 13:03:20.083505+00
9875669f-138a-411d-8b65-ecf1b49fb8cb	\N	6f5cdb59-40f2-4e08-b401-3cf9c97605fb	auth.login	user	6f5cdb59-40f2-4e08-b401-3cf9c97605fb	{}	2026-09-29 13:03:27.543083+00
2195ed87-4b35-49b2-8707-ae426e6c6094	\N	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	auth.login	user	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	{}	2026-09-30 08:46:08.224327+00
28daa247-112c-4792-b86c-ef56dce17181	\N	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	auth.login	user	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	{}	2026-09-30 08:47:18.068326+00
348c3274-028e-47cd-a75f-f2862c4590d5	\N	71184895-f4d1-46e8-8928-d3963e959ceb	auth.login	user	71184895-f4d1-46e8-8928-d3963e959ceb	{}	2026-09-30 08:47:26.517322+00
888b7bdd-40f5-4e11-b3b7-7fb158acc4f8	\N	6f5cdb59-40f2-4e08-b401-3cf9c97605fb	auth.login	user	6f5cdb59-40f2-4e08-b401-3cf9c97605fb	{}	2026-09-30 08:47:32.623238+00
907b92f4-3cb2-4d37-9f33-3ade8c352db2	\N	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	auth.login	user	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	{}	2026-09-30 08:55:06.779355+00
28b35003-be85-479f-9d2f-629f8260ccb4	\N	71184895-f4d1-46e8-8928-d3963e959ceb	auth.login	user	71184895-f4d1-46e8-8928-d3963e959ceb	{}	2026-09-30 08:55:14.435716+00
d6f6e2b6-d102-4a01-9baa-39d042542ca9	\N	6f5cdb59-40f2-4e08-b401-3cf9c97605fb	auth.login	user	6f5cdb59-40f2-4e08-b401-3cf9c97605fb	{}	2026-09-30 08:55:19.866911+00
103356cf-2624-42e4-89ac-773da052c1f1	\N	1bf026a2-eaf2-4876-a8ba-54547d8faf74	auth.login	user	1bf026a2-eaf2-4876-a8ba-54547d8faf74	{}	2026-09-30 09:19:32.160045+00
2b53972a-5e7b-4b18-8322-d276297bc91b	\N	c987c188-8757-40a1-a07e-239c1e63cba3	auth.login	user	c987c188-8757-40a1-a07e-239c1e63cba3	{}	2026-09-30 09:19:39.459051+00
441a1e70-ddf5-4747-a07e-452a174934cb	\N	2bd80cc6-e888-4554-987f-d7633f01f081	auth.login	user	2bd80cc6-e888-4554-987f-d7633f01f081	{}	2026-09-30 09:19:46.598834+00
fdacf23e-6b06-4018-98bb-7cbd0bb075ab	\N	872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	auth.login	user	872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	{}	2026-09-30 09:19:53.470779+00
16a2d325-abe4-47a3-81b1-528ea5cb26dd	\N	1b68760e-8a44-4fd0-bb21-810a80123cd6	auth.login	user	1b68760e-8a44-4fd0-bb21-810a80123cd6	{}	2026-09-30 09:20:00.218822+00
ade84605-c38f-42de-a426-138a632f3654	\N	1bf026a2-eaf2-4876-a8ba-54547d8faf74	auth.login	user	1bf026a2-eaf2-4876-a8ba-54547d8faf74	{}	2026-09-30 09:21:30.258872+00
7e62bef5-75a8-4067-b757-b2de2a87377a	\N	c987c188-8757-40a1-a07e-239c1e63cba3	auth.login	user	c987c188-8757-40a1-a07e-239c1e63cba3	{}	2026-09-30 09:21:37.476286+00
17c65bd4-9d17-4670-8bf1-19a8af953111	\N	2bd80cc6-e888-4554-987f-d7633f01f081	auth.login	user	2bd80cc6-e888-4554-987f-d7633f01f081	{}	2026-09-30 09:21:44.000105+00
85aea4bb-cb5d-4969-8d8c-8fad5e336617	\N	872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	auth.login	user	872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	{}	2026-09-30 09:21:50.305674+00
35ba3b1b-8184-4483-88c8-9c4ccd8a9fa8	\N	1b68760e-8a44-4fd0-bb21-810a80123cd6	auth.login	user	1b68760e-8a44-4fd0-bb21-810a80123cd6	{}	2026-09-30 09:21:56.320564+00
f993435c-f19a-4091-9e4a-f8e1fb608c92	\N	1bf026a2-eaf2-4876-a8ba-54547d8faf74	auth.login	user	1bf026a2-eaf2-4876-a8ba-54547d8faf74	{}	2026-09-30 09:25:13.415575+00
e8413092-a6af-4679-b7a3-362cbfbdc5cc	\N	c987c188-8757-40a1-a07e-239c1e63cba3	auth.login	user	c987c188-8757-40a1-a07e-239c1e63cba3	{}	2026-09-30 09:25:21.272906+00
3af079b5-a7ca-4cbd-b4d8-68c2bd42fad4	\N	2bd80cc6-e888-4554-987f-d7633f01f081	auth.login	user	2bd80cc6-e888-4554-987f-d7633f01f081	{}	2026-09-30 09:25:28.205155+00
99af6626-941d-474f-a26c-84b5718f19ab	\N	872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	auth.login	user	872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	{}	2026-09-30 09:25:34.509255+00
5f768a95-3183-43dd-a5dc-e84780633874	\N	1b68760e-8a44-4fd0-bb21-810a80123cd6	auth.login	user	1b68760e-8a44-4fd0-bb21-810a80123cd6	{}	2026-09-30 09:25:40.675227+00
\.


--
-- Data for Name: budgets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.budgets (id, organization_id, building_id, period, amount_minor, currency, created_by) FROM stdin;
\.


--
-- Data for Name: buildings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.buildings (id, organization_id, name, address, is_demo) FROM stdin;
48209bba-884b-45fd-b3b3-0d2c1d7d8386	ad59cf43-12af-4dd1-bb11-abfd4a096457	Demo Park	Երևան · ցուցադրական հասցե	t
85b368d0-b0fa-4e61-8346-60c62f40ebe2	d6260f44-6257-4dc0-8eac-bb8b39b0c62c	Demo Residence	Երևան · ցուցադրական հասցե	t
\.


--
-- Data for Name: charges; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.charges (id, organization_id, payer_assignment_id, period, tariff_id, invoice_id) FROM stdin;
\.


--
-- Data for Name: defect_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.defect_history (id, defect_id, actor_id, action, note, created_at) FROM stdin;
\.


--
-- Data for Name: defects; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.defects (id, organization_id, unit_id, subject, location, description, contractor_id, due_on, status, report, version, created_by, created_at) FROM stdin;
cfa52cc0-596a-4d4c-8a20-d3fdb1733dac	ad59cf43-12af-4dd1-bb11-abfd4a096457	04e11a48-c552-4c9d-a12e-07a15357b7e3	Demo · Պատուհանի կարգավորում	Խոհանոց	Ցուցադրական առաջադրանք՝ պատուհանի կարգավորում։	872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	2026-10-05	assigned		1	10fc53b7-d4af-4f43-ab65-0f5ecfc4540d	2026-09-28 21:41:01.32189+00
\.


--
-- Data for Name: documents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.documents (id, organization_id, building_id, unit_id, title, visibility, storage_key, media_type, uploaded_by, created_at) FROM stdin;
\.


--
-- Data for Name: entrances; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.entrances (id, organization_id, building_id, name) FROM stdin;
\.


--
-- Data for Name: expenses; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.expenses (id, organization_id, building_id, description, amount_minor, currency, created_by, approved_by, approved_at) FROM stdin;
\.


--
-- Data for Name: file_attachments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.file_attachments (id, defect_id, author_id, storage_key, created_at) FROM stdin;
\.


--
-- Data for Name: floors; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.floors (id, organization_id, building_id, entrance_id, number) FROM stdin;
\.


--
-- Data for Name: handover_cases; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.handover_cases (id, organization_id, unit_id, status, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: import_jobs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.import_jobs (id, organization_id, building_id, created_by, rows, errors, status, created_at, committed_at) FROM stdin;
\.


--
-- Data for Name: incidents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.incidents (id, organization_id, building_id, created_by, description, created_at) FROM stdin;
\.


--
-- Data for Name: inspections; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inspections (id, handover_id, scheduled_at, checklist, report, completed_at, completed_by) FROM stdin;
\.


--
-- Data for Name: invoice_lines; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.invoice_lines (id, invoice_id, description, quantity_hundredths, rate_minor, amount_minor) FROM stdin;
\.


--
-- Data for Name: invoices; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.invoices (id, organization_id, unit_id, payer_user_id, period, amount_minor, currency, status, is_demo, created_by, published_by, published_at) FROM stdin;
edb6df14-5732-46c8-8803-89ee225cbc2e	ad59cf43-12af-4dd1-bb11-abfd4a096457	04e11a48-c552-4c9d-a12e-07a15357b7e3	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	2026-09-01	2450000	AMD	published	t	\N	\N	\N
96016d1a-cb50-41c3-9e0c-c1f6a4d4713e	ad59cf43-12af-4dd1-bb11-abfd4a096457	04e11a48-c552-4c9d-a12e-07a15357b7e3	71184895-f4d1-46e8-8928-d3963e959ceb	2026-09-01	1250000	AMD	published	t	\N	\N	\N
4824e805-18ea-4c85-977b-a734c7752da3	d6260f44-6257-4dc0-8eac-bb8b39b0c62c	1244c29a-d65a-4d21-bd84-34c86d570fa8	09f2e5ec-5652-4c62-98b7-2adb18038ec1	2026-09-01	3200000	AMD	published	t	\N	\N	\N
\.


--
-- Data for Name: leases; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.leases (id, organization_id, unit_id, renter_id, starts_on, ends_on, amount_minor, currency, created_by) FROM stdin;
\.


--
-- Data for Name: maintenance_plans; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.maintenance_plans (id, organization_id, asset_id, title, due_on, completed_at, completed_by, report) FROM stdin;
3c78737e-cfc0-4ac1-a887-1ab1680f97d3	ad59cf43-12af-4dd1-bb11-abfd4a096457	ed537243-8a6f-4fd7-90d6-f402e5ca179e	Demo · Պլանային ստուգում	2026-10-05	\N	\N	
\.


--
-- Data for Name: meetings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.meetings (id, organization_id, building_id, title, starts_at, ends_at, created_by) FROM stdin;
\.


--
-- Data for Name: memberships; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.memberships (id, user_id, organization_id, active) FROM stdin;
a182dcc2-cfd5-4a2c-8bdf-1113dead122e	9bcbebb1-868c-4d51-b712-08d5a29f7995	ad59cf43-12af-4dd1-bb11-abfd4a096457	t
2b122264-6ea8-425c-9791-39692d053532	2b2502e9-be78-4d2b-a74b-c65b28faad22	ad59cf43-12af-4dd1-bb11-abfd4a096457	t
81d95e8d-4c5e-4185-bbb5-00de0e448296	10fc53b7-d4af-4f43-ab65-0f5ecfc4540d	ad59cf43-12af-4dd1-bb11-abfd4a096457	t
cd50cb35-86df-4f43-97fd-281e2c441ef3	1bf026a2-eaf2-4876-a8ba-54547d8faf74	ad59cf43-12af-4dd1-bb11-abfd4a096457	t
65de5e87-72d1-452e-80c9-45630cda5a95	5d897d84-8ec8-4942-9cb3-6ca1a84f569f	ad59cf43-12af-4dd1-bb11-abfd4a096457	t
4234ffc1-1f42-45f1-bb7a-369c63d838e5	c987c188-8757-40a1-a07e-239c1e63cba3	ad59cf43-12af-4dd1-bb11-abfd4a096457	t
3417a46e-d87d-4563-8845-129006215e6f	2bd80cc6-e888-4554-987f-d7633f01f081	ad59cf43-12af-4dd1-bb11-abfd4a096457	t
0e46947e-932d-4373-afe9-c00c9d5f028a	872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	ad59cf43-12af-4dd1-bb11-abfd4a096457	t
4f6603e0-1958-4e35-99fa-fffbf2cb8015	1b68760e-8a44-4fd0-bb21-810a80123cd6	ad59cf43-12af-4dd1-bb11-abfd4a096457	t
521bd36e-cf5c-467c-9958-b0304bcfda5f	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	ad59cf43-12af-4dd1-bb11-abfd4a096457	t
5a8b7bac-3474-46ac-8024-1d24593e6038	71184895-f4d1-46e8-8928-d3963e959ceb	ad59cf43-12af-4dd1-bb11-abfd4a096457	t
233e1303-16c2-42c9-a8c3-29ac467b709c	6f5cdb59-40f2-4e08-b401-3cf9c97605fb	ad59cf43-12af-4dd1-bb11-abfd4a096457	t
78837303-0924-4d7d-ad0b-071ce35ed535	09f2e5ec-5652-4c62-98b7-2adb18038ec1	d6260f44-6257-4dc0-8eac-bb8b39b0c62c	t
\.


--
-- Data for Name: meter_readings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.meter_readings (id, meter_id, value_thousandths, period, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: meters; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.meters (id, organization_id, unit_id, serial_number, kind, created_at) FROM stdin;
324b4c3f-f8f5-4370-9b99-fb3a448d3f7f	ad59cf43-12af-4dd1-bb11-abfd4a096457	04e11a48-c552-4c9d-a12e-07a15357b7e3	DEMO-WATER-102	water	2026-09-28 21:41:01.32189+00
\.


--
-- Data for Name: module_entitlements; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.module_entitlements (organization_id, module, enabled) FROM stdin;
ad59cf43-12af-4dd1-bb11-abfd4a096457	requests	t
ad59cf43-12af-4dd1-bb11-abfd4a096457	finance	t
ad59cf43-12af-4dd1-bb11-abfd4a096457	handover	t
ad59cf43-12af-4dd1-bb11-abfd4a096457	access	t
d6260f44-6257-4dc0-8eac-bb8b39b0c62c	requests	t
d6260f44-6257-4dc0-8eac-bb8b39b0c62c	finance	t
d6260f44-6257-4dc0-8eac-bb8b39b0c62c	handover	t
d6260f44-6257-4dc0-8eac-bb8b39b0c62c	access	t
ad59cf43-12af-4dd1-bb11-abfd4a096457	community	t
ad59cf43-12af-4dd1-bb11-abfd4a096457	maintenance	t
ad59cf43-12af-4dd1-bb11-abfd4a096457	meters	t
d6260f44-6257-4dc0-8eac-bb8b39b0c62c	community	t
d6260f44-6257-4dc0-8eac-bb8b39b0c62c	maintenance	t
d6260f44-6257-4dc0-8eac-bb8b39b0c62c	meters	t
ad59cf43-12af-4dd1-bb11-abfd4a096457	documents	t
d6260f44-6257-4dc0-8eac-bb8b39b0c62c	documents	t
\.


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.notifications (id, user_id, organization_id, kind, entity_id, read_at, created_at) FROM stdin;
19d4f04b-4f80-4cc4-b213-bcdc1d52cc8a	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	ad59cf43-12af-4dd1-bb11-abfd4a096457	request.assign	73ca2060-c2e8-434e-897c-1ff53710cb46	\N	2026-09-28 21:41:01.32189+00
\.


--
-- Data for Name: occupancies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.occupancies (id, organization_id, unit_id, user_id, starts_on, ends_on) FROM stdin;
04fd1eea-dba2-433e-bf8b-27953d83100b	ad59cf43-12af-4dd1-bb11-abfd4a096457	04e11a48-c552-4c9d-a12e-07a15357b7e3	6f5cdb59-40f2-4e08-b401-3cf9c97605fb	2026-09-28	\N
\.


--
-- Data for Name: onboarding_steps; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.onboarding_steps (id, organization_id, assigned_to, title, due_on, completed_at) FROM stdin;
a3d1ef28-c2f1-442b-b09d-3f4226501ca4	ad59cf43-12af-4dd1-bb11-abfd4a096457	6b9accbd-a053-46de-8c7a-5fac7a9ebd96	Demo · Թիմի ուսուցում	2026-10-05	\N
\.


--
-- Data for Name: organizations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.organizations (id, name, timezone, currency, is_demo, created_at, contact_email, contact_phone, brand_color) FROM stdin;
ad59cf43-12af-4dd1-bb11-abfd4a096457	Դեմո կառավարում · Հյուսիս	Asia/Yerevan	AMD	t	2026-09-27 21:38:44.336042+00			#FF6B0A
d6260f44-6257-4dc0-8eac-bb8b39b0c62c	Դեմո կառավարում · Հարավ	Asia/Yerevan	AMD	t	2026-09-27 21:38:44.336042+00			#FF6B0A
\.


--
-- Data for Name: ownerships; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ownerships (id, organization_id, unit_id, user_id, starts_on, ends_on, share_basis_points) FROM stdin;
22b61c15-c508-4e31-aadb-ffcf51b569a9	ad59cf43-12af-4dd1-bb11-abfd4a096457	04e11a48-c552-4c9d-a12e-07a15357b7e3	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	2026-09-28	\N	10000
\.


--
-- Data for Name: payer_assignments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.payer_assignments (id, organization_id, unit_id, payer_user_id, service_id, starts_on, ends_on) FROM stdin;
\.


--
-- Data for Name: payment_allocations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.payment_allocations (id, organization_id, payment_id, invoice_id, amount_minor, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.payments (id, organization_id, payer_user_id, amount_minor, currency, source, reference, confirmed_by, created_at) FROM stdin;
\.


--
-- Data for Name: permissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.permissions (key) FROM stdin;
organizations.read
organizations.manage
platform.audit
platform.invite
support.queue
support.access.request
properties.read
properties.manage
people.read
people.invite
roles.assign
modules.read
modules.manage
audit.read
billing.read
reports.read
defects.read
defects.manage
defects.accept
requests.read
requests.assign
workorders.accept
announcements.read
billing.calculate
billing.publish
payments.reconcile
workorders.assigned
workorders.execute
defects.assigned
defects.execute
access.validate
access.events
incidents.create
properties.own
billing.own
requests.own
requests.create
residents.delegate
access.create
support.access.approve
announcements.manage
assets.read
assets.manage
meters.own
meters.manage
meetings.read
meetings.manage
meetings.vote
expenses.read
expenses.manage
expenses.approve
imports.manage
reports.export
documents.read
documents.manage
leases.read
leases.manage
handover.read
handover.manage
subscriptions.manage
support.cases
support.cases.create
onboarding.manage
leases.own
organization.settings
\.


--
-- Data for Name: request_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.request_history (id, request_id, actor_id, actor_role, action, from_status, to_status, note, created_at) FROM stdin;
cc7c84e0-0361-4e6d-b476-1c401ad455d4	3cf28444-9237-4d75-bf20-a365b146febe	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	unit_owner	create	new	new		2026-09-28 08:28:06.27628+00
c9e06f9d-3db8-49f8-8527-b39d410308f7	3cf28444-9237-4d75-bf20-a365b146febe	c987c188-8757-40a1-a07e-239c1e63cba3	dispatcher	assign	new	assigned		2026-09-28 08:28:06.824207+00
9f9e3f04-3e42-4039-85d9-5cecdbf89288	3cf28444-9237-4d75-bf20-a365b146febe	2bd80cc6-e888-4554-987f-d7633f01f081	technician	start	assigned	in_progress		2026-09-28 08:28:07.352976+00
8bddf8b6-1333-46f2-934e-f6e036bd1f5c	3cf28444-9237-4d75-bf20-a365b146febe	2bd80cc6-e888-4554-987f-d7633f01f081	technician	report	in_progress	review	Светильник заменён, работа проверена.	2026-09-28 08:28:07.652728+00
024e8bf1-ce5c-4b54-8081-cd102fcfa635	3cf28444-9237-4d75-bf20-a365b146febe	1bf026a2-eaf2-4876-a8ba-54547d8faf74	manager	approve	review	resident_review		2026-09-28 08:28:08.20467+00
ce96cc4d-fb72-4d37-ac50-2566aa7c9405	3cf28444-9237-4d75-bf20-a365b146febe	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	unit_owner	confirm	resident_review	closed		2026-09-28 08:28:08.778824+00
8dcc8621-451b-4f91-84b2-1bc9dec49501	73ca2060-c2e8-434e-897c-1ff53710cb46	c987c188-8757-40a1-a07e-239c1e63cba3	dispatcher	assign	new	assigned	Demo assignment	2026-09-28 21:41:01.32189+00
\.


--
-- Data for Name: request_messages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.request_messages (id, request_id, author_id, body, internal, created_at) FROM stdin;
\.


--
-- Data for Name: request_photos; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.request_photos (id, request_id, author_id, storage_key, created_at) FROM stdin;
\.


--
-- Data for Name: resident_delegations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.resident_delegations (id, organization_id, owner_assignment_id, unit_id, permission_keys, expires_at, revoked_at, assignment_id, created_at) FROM stdin;
\.


--
-- Data for Name: resident_requests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.resident_requests (id, organization_id, unit_id, author_user_id, subject, status, created_at, is_demo, description, version) FROM stdin;
3cf28444-9237-4d75-bf20-a365b146febe	ad59cf43-12af-4dd1-bb11-abfd4a096457	04e11a48-c552-4c9d-a12e-07a15357b7e3	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	Проверка UI 1790584086158	closed	2026-09-28 08:28:06.27628+00	f	Проверка сквозного процесса через браузер	6
73ca2060-c2e8-434e-897c-1ff53710cb46	ad59cf43-12af-4dd1-bb11-abfd4a096457	04e11a48-c552-4c9d-a12e-07a15357b7e3	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	Մուտքի լուսավորությունը չի աշխատում	assigned	2026-09-27 21:38:44.336042+00	t		2
\.


--
-- Data for Name: role_assignments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.role_assignments (id, user_id, organization_id, role_key, building_id, unit_id, active, starts_at, expires_at) FROM stdin;
9b90d564-ea54-4a6d-8f8f-1fa044d33262	059cedfb-5910-42bc-ad30-3c370f2afd3c	\N	platform_admin	\N	\N	t	2026-09-27 21:38:44.336042+00	\N
f7a1ade2-a5db-4ab7-9aca-789e9d4aca9d	6b9accbd-a053-46de-8c7a-5fac7a9ebd96	\N	support	\N	\N	t	2026-09-27 21:38:44.336042+00	\N
65c2b9ac-a00f-46cc-8095-92a3be542fe6	9bcbebb1-868c-4d51-b712-08d5a29f7995	ad59cf43-12af-4dd1-bb11-abfd4a096457	org_admin	\N	\N	t	2026-09-27 21:38:44.336042+00	\N
53cee8ec-5d7e-4036-a393-79f42e161ffe	2b2502e9-be78-4d2b-a74b-c65b28faad22	ad59cf43-12af-4dd1-bb11-abfd4a096457	portfolio_owner	48209bba-884b-45fd-b3b3-0d2c1d7d8386	\N	t	2026-09-27 21:38:44.336042+00	\N
a3825911-b5fd-45e6-9669-979863516e0a	10fc53b7-d4af-4f43-ab65-0f5ecfc4540d	ad59cf43-12af-4dd1-bb11-abfd4a096457	developer	\N	\N	t	2026-09-27 21:38:44.336042+00	\N
d6618f4b-0b46-4b2b-acc6-bcabfba3708a	1bf026a2-eaf2-4876-a8ba-54547d8faf74	ad59cf43-12af-4dd1-bb11-abfd4a096457	manager	\N	\N	t	2026-09-27 21:38:44.336042+00	\N
82fc3911-c5f2-4e95-9ed3-0431a4b7a0ea	5d897d84-8ec8-4942-9cb3-6ca1a84f569f	ad59cf43-12af-4dd1-bb11-abfd4a096457	accountant	\N	\N	t	2026-09-27 21:38:44.336042+00	\N
57aa52ea-7b35-4b62-8b9e-0269251bae40	c987c188-8757-40a1-a07e-239c1e63cba3	ad59cf43-12af-4dd1-bb11-abfd4a096457	dispatcher	\N	\N	t	2026-09-27 21:38:44.336042+00	\N
cd894ef7-6a67-4af0-9609-b9c7f402e9be	2bd80cc6-e888-4554-987f-d7633f01f081	ad59cf43-12af-4dd1-bb11-abfd4a096457	technician	48209bba-884b-45fd-b3b3-0d2c1d7d8386	\N	t	2026-09-27 21:38:44.336042+00	\N
614a815a-89d9-4414-9e0c-5b5d2e68865b	872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	ad59cf43-12af-4dd1-bb11-abfd4a096457	contractor	48209bba-884b-45fd-b3b3-0d2c1d7d8386	\N	t	2026-09-27 21:38:44.336042+00	\N
44dfb10e-669c-404c-bef5-b62a29b20b16	1b68760e-8a44-4fd0-bb21-810a80123cd6	ad59cf43-12af-4dd1-bb11-abfd4a096457	security	48209bba-884b-45fd-b3b3-0d2c1d7d8386	\N	t	2026-09-27 21:38:44.336042+00	\N
b22ed4e6-d09d-417d-8440-bed0808e45d1	7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	ad59cf43-12af-4dd1-bb11-abfd4a096457	unit_owner	48209bba-884b-45fd-b3b3-0d2c1d7d8386	04e11a48-c552-4c9d-a12e-07a15357b7e3	t	2026-09-27 21:38:44.336042+00	\N
1d648dfa-5955-484e-bcae-51220d2cef60	71184895-f4d1-46e8-8928-d3963e959ceb	ad59cf43-12af-4dd1-bb11-abfd4a096457	renter	48209bba-884b-45fd-b3b3-0d2c1d7d8386	04e11a48-c552-4c9d-a12e-07a15357b7e3	t	2026-09-27 21:38:44.336042+00	2026-10-27 21:38:49.519+00
c67b268d-d6b0-4cf2-9210-56562affe97d	6f5cdb59-40f2-4e08-b401-3cf9c97605fb	ad59cf43-12af-4dd1-bb11-abfd4a096457	family	48209bba-884b-45fd-b3b3-0d2c1d7d8386	04e11a48-c552-4c9d-a12e-07a15357b7e3	t	2026-09-27 21:38:44.336042+00	\N
f226a100-c197-4a05-900f-6c2c8135ab55	9bcbebb1-868c-4d51-b712-08d5a29f7995	ad59cf43-12af-4dd1-bb11-abfd4a096457	manager	\N	\N	t	2026-09-27 21:38:44.336042+00	\N
595eb4f9-2fcb-43cb-b0f6-c4cc53097b1f	09f2e5ec-5652-4c62-98b7-2adb18038ec1	d6260f44-6257-4dc0-8eac-bb8b39b0c62c	org_admin	\N	\N	t	2026-09-27 21:38:44.336042+00	\N
\.


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.role_permissions (role_key, permission_key) FROM stdin;
platform_admin	organizations.read
platform_admin	organizations.manage
platform_admin	platform.audit
platform_admin	platform.invite
support	support.queue
support	support.access.request
org_admin	properties.read
org_admin	properties.manage
org_admin	people.read
org_admin	people.invite
org_admin	roles.assign
org_admin	modules.read
org_admin	modules.manage
org_admin	audit.read
portfolio_owner	properties.read
portfolio_owner	billing.read
portfolio_owner	reports.read
developer	properties.read
developer	defects.read
developer	defects.manage
developer	defects.accept
manager	properties.read
manager	people.read
manager	requests.read
manager	requests.assign
manager	workorders.accept
manager	announcements.read
manager	billing.read
accountant	properties.read
accountant	billing.read
accountant	billing.calculate
accountant	billing.publish
accountant	payments.reconcile
dispatcher	properties.read
dispatcher	requests.read
dispatcher	requests.assign
technician	workorders.assigned
technician	workorders.execute
contractor	defects.assigned
contractor	defects.execute
security	access.validate
security	access.events
security	incidents.create
unit_owner	properties.own
unit_owner	billing.own
unit_owner	requests.own
unit_owner	requests.create
unit_owner	announcements.read
unit_owner	residents.delegate
renter	properties.own
renter	billing.own
renter	requests.own
renter	requests.create
renter	announcements.read
family	properties.own
family	requests.own
family	requests.create
family	announcements.read
unit_owner	access.create
renter	access.create
org_admin	support.access.approve
manager	announcements.manage
manager	assets.read
manager	assets.manage
manager	meters.manage
manager	meetings.read
manager	meetings.manage
manager	expenses.read
manager	expenses.manage
manager	reports.export
accountant	expenses.read
accountant	expenses.manage
accountant	reports.export
portfolio_owner	expenses.read
portfolio_owner	expenses.approve
portfolio_owner	reports.export
org_admin	imports.manage
unit_owner	meters.own
renter	meters.own
unit_owner	meetings.read
unit_owner	meetings.vote
platform_admin	subscriptions.manage
support	support.cases
org_admin	support.cases.create
org_admin	documents.read
org_admin	documents.manage
manager	documents.read
manager	documents.manage
manager	leases.read
manager	leases.manage
portfolio_owner	leases.read
unit_owner	documents.read
renter	documents.read
family	documents.read
developer	handover.read
developer	handover.manage
support	onboarding.manage
platform_admin	onboarding.manage
unit_owner	leases.own
renter	leases.own
org_admin	organization.settings
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.roles (key, shell) FROM stdin;
platform_admin	platform
support	platform
org_admin	workspace
portfolio_owner	workspace
developer	workspace
manager	workspace
accountant	workspace
dispatcher	workspace
technician	field
contractor	field
security	field
unit_owner	home
renter	home
family	home
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.schema_migrations (name, checksum, applied_at) FROM stdin;
001_foundation.sql	ad21c600726837ff74e3c6134896ae374a542ca9a9631e9ab0cae77b62a06ac2	2026-09-27 21:37:57.928935+00
002_role_catalog.sql	4daede48be7bc18adc9129ee83b93c7d49279b73db389191ca9f618ad58cb659	2026-09-27 21:38:27.577533+00
003_invoice_delete_guard.sql	f6cefcb3c74d23da16e4111635311750bff0647ee8a809cf5e2921071f926b68	2026-09-28 05:27:33.425544+00
004_workflow.sql	c516b2b833efd26867aa4c9ab3947ef5d99f95be94019b8da8640884ed093b54	2026-09-28 08:23:55.340585+00
005_history_immutable.sql	4a7ef9299d85b6069a078301e0bb12b096ea86f9fc6032fa321e4e235ce83edf	2026-09-28 08:33:25.255328+00
006_finance.sql	76bece341606f3290919a85f1446d93fe0de8f3de16c29df90a2c4fc7265dce4	2026-09-28 10:43:33.40143+00
007_operations.sql	313c6fdf0e9d49fda3cce98ffe10b7ce531aa5722a0eac4258a7044fdb66295e	2026-09-28 10:43:33.603737+00
008_security.sql	bf23f9af4621c48330dd22ee47afb51467aeab27089e07dd5d1abec08e3c3e6e	2026-09-28 10:43:33.751433+00
009_services.sql	7e5ffc5d9caa3a936591f9dd0d3ac26327551ed25490b7416a1e94c0468cc858	2026-09-28 10:43:33.796531+00
010_lifecycle.sql	9d79cb8e7dceaae7b3344af52d02338c0c3191f55ce1d1d0ea1bf78e1e7aa143	2026-09-28 10:43:34.053223+00
011_reporting.sql	beb1493f732607e08a091209579cc290a3904beca33d24b174da284b404bec60	2026-09-28 21:40:43.701053+00
012_work_evidence.sql	b84ea1c3c69bf37f8fb47174af8c96464bb375319bf36278812b3e6d200fe4ea	2026-09-28 21:40:43.824661+00
\.


--
-- Data for Name: services; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.services (id, organization_id, name) FROM stdin;
\.


--
-- Data for Name: subscription_plans; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_plans (id, name, amount_minor, currency, building_limit) FROM stdin;
\.


--
-- Data for Name: subscriptions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscriptions (id, organization_id, plan_id, starts_on, ends_on, status, created_by) FROM stdin;
\.


--
-- Data for Name: support_cases; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.support_cases (id, organization_id, created_by, assigned_to, subject, body, status, reply, created_at) FROM stdin;
\.


--
-- Data for Name: tariffs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tariffs (id, organization_id, service_id, amount_minor, currency, basis, created_at) FROM stdin;
\.


--
-- Data for Name: units; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.units (id, organization_id, building_id, number, area, is_demo) FROM stdin;
04e11a48-c552-4c9d-a12e-07a15357b7e3	ad59cf43-12af-4dd1-bb11-abfd4a096457	48209bba-884b-45fd-b3b3-0d2c1d7d8386	102	56.40	t
154a0965-f798-4024-902d-d4d64d1d1eeb	ad59cf43-12af-4dd1-bb11-abfd4a096457	48209bba-884b-45fd-b3b3-0d2c1d7d8386	103	72.10	t
1244c29a-d65a-4d21-bd84-34c86d570fa8	d6260f44-6257-4dc0-8eac-bb8b39b0c62c	85b368d0-b0fa-4e61-8346-60c62f40ebe2	201	62.00	t
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, email, name, password_hash, blocked, locale, currency, created_at) FROM stdin;
6b9accbd-a053-46de-8c7a-5fac7a9ebd96	support@vernatun.test	Դավիթ Մինասյան	$2b$12$XKN7iqxKmPJiM3aXppSK3Odyd/Gxh4ZO1uGV7ssMAumsBxAwj8E4S	f	hy	AMD	2026-09-27 21:38:44.336042+00
9bcbebb1-868c-4d51-b712-08d5a29f7995	org.admin@vernatun.test	Աննա Հարությունյան	$2b$12$aGdjgEr/57nbq87afEQ8.e.g/Ycrrh2nXHN1RkTn6ypLABwc7FfK2	f	hy	AMD	2026-09-27 21:38:44.336042+00
2b2502e9-be78-4d2b-a74b-c65b28faad22	portfolio.owner@vernatun.test	Սերգեյ Պետրով	$2b$12$TMrj/hGRuHgSm9mqUjAUwu94R9QgUV1cc/m3WZ8I7Z5KNOsprSHB2	f	hy	AMD	2026-09-27 21:38:44.336042+00
5d897d84-8ec8-4942-9cb3-6ca1a84f569f	accountant@vernatun.test	Բորիս Սարգսյան	$2b$12$0tUT7AJEUy8VOQ6xrzJdze1QHLMTv5OiQzXqg222wFnxq8SpzZqV.	f	hy	AMD	2026-09-27 21:38:44.336042+00
09f2e5ec-5652-4c62-98b7-2adb18038ec1	second.org@vernatun.test	Երկրորդ կազմակերպության օգտատեր	$2b$12$M.H9KhgsoEQv3XqHp2251.E0E8zp/2UVNls/74Jn11wSBKbBlwQF6	f	hy	AMD	2026-09-27 21:38:44.336042+00
1bf026a2-eaf2-4876-a8ba-54547d8faf74	manager@vernatun.test	Իվան Հարությունյան	$2b$12$Mztpp4OZ.etzXvo7Tg3g2OoC/MyO88o3JwY8Blars3GRLZLTQhSfm	f	ru	AMD	2026-09-27 21:38:44.336042+00
7cf3394b-8473-4eb0-9fb9-5e395e9e5e5a	unit.owner@vernatun.test	Աննա Պետրոսյան	$2b$12$1nQiZPRbuK97ciG2947p3e3yn66Th91gTpcUyC1jVyHiAZgeaU2D2	f	ru	AMD	2026-09-27 21:38:44.336042+00
c987c188-8757-40a1-a07e-239c1e63cba3	dispatcher@vernatun.test	Մարիա Կովալևա	$2b$12$pm2M6uOpI4cFgkaXuVBhmu2QeJGAYp0n9Lv0XtDw55lxb9z2wvMzi	f	ru	AMD	2026-09-27 21:38:44.336042+00
71184895-f4d1-46e8-8928-d3963e959ceb	renter@vernatun.test	Միքայել Սարգսյան	$2b$12$QIn.TD42IfJGddbGJI2hwOmDxU7sQhq90osJ4qCeWprN5mRpMCa6u	f	ru	AMD	2026-09-27 21:38:44.336042+00
059cedfb-5910-42bc-ad30-3c370f2afd3c	platform.admin@vernatun.test	Իվան Պետրով	$2b$12$xar5n2K/PyXPY6M3shharO8inAL3ogCG2zM7hTzxjdKrTzkXQ9LOq	f	en	AMD	2026-09-27 21:38:44.336042+00
10fc53b7-d4af-4f43-ab65-0f5ecfc4540d	developer@vernatun.test	Արմեն Սարգսյան	$2b$12$JWKXJ7cTe95T9lfJ99bdU.ub7/zl6ytHJ/tOK89xm5arc8C1ZawyG	f	ru	AMD	2026-09-27 21:38:44.336042+00
2bd80cc6-e888-4554-987f-d7633f01f081	technician@vernatun.test	Արտեմ Գրիգորյան	$2b$12$lzhmiI4JRRvFjP6iq4LZY.mFf6bAMJCsS7gpTPht7f.j6fkdUl94S	f	ru	AMD	2026-09-27 21:38:44.336042+00
6f5cdb59-40f2-4e08-b401-3cf9c97605fb	family@vernatun.test	Արման Պետրոսյան	$2b$12$oU.w9B1EITCbYF9PQuHaTu6xGSKF9TBeCeOh4oy/Luz0EZ4GKBwWi	f	ru	AMD	2026-09-27 21:38:44.336042+00
872bdd6c-aa72-43ea-b9a8-1f6a334f78a5	contractor@vernatun.test	Նարեկ Ավետիսյան	$2b$12$kedcuASYuhSfXsUE9NQiOOAO.5ihrjQBHWQWUhYu6shTsHZsmw6GK	f	ru	AMD	2026-09-27 21:38:44.336042+00
1b68760e-8a44-4fd0-bb21-810a80123cd6	security@vernatun.test	Սամվել Պետրոսյան	$2b$12$BE2GMDE9fnPwZkIjr6M14uAEt1kn8JPz6brisobgLA2K376LhqBUS	f	ru	AMD	2026-09-27 21:38:44.336042+00
\.


--
-- Data for Name: votes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.votes (id, agenda_item_id, unit_id, voter_id, choice, created_at) FROM stdin;
\.


--
-- Data for Name: warranties; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.warranties (id, organization_id, unit_id, description, starts_on, ends_on) FROM stdin;
\.


--
-- Data for Name: work_orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.work_orders (id, request_id, technician_id, assigned_by, status, checklist, report, version, created_at, updated_at) FROM stdin;
25733f7e-a6f0-4248-a03e-b8b4a1103d67	3cf28444-9237-4d75-bf20-a365b146febe	2bd80cc6-e888-4554-987f-d7633f01f081	c987c188-8757-40a1-a07e-239c1e63cba3	closed	[{"done": true, "text": "Проверить освещение"}]	Светильник заменён, работа проверена.	6	2026-09-28 08:28:06.824207+00	2026-09-28 08:28:08.778824+00
b2f0b381-f7d4-4a57-89cd-430932e732f6	73ca2060-c2e8-434e-897c-1ff53710cb46	2bd80cc6-e888-4554-987f-d7633f01f081	c987c188-8757-40a1-a07e-239c1e63cba3	assigned	[{"done": false, "text": "Demo · Ստուգել լուսավորությունը"}]		1	2026-09-28 21:41:01.32189+00	2026-09-28 21:41:01.32189+00
\.


--
-- Data for Name: work_reports; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.work_reports (id, work_order_id, reporter_id, body, checklist, created_at) FROM stdin;
\.


--
-- Name: access_events access_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_events
    ADD CONSTRAINT access_events_pkey PRIMARY KEY (id);


--
-- Name: adjustments adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adjustments
    ADD CONSTRAINT adjustments_pkey PRIMARY KEY (id);


--
-- Name: agenda_items agenda_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_items
    ADD CONSTRAINT agenda_items_pkey PRIMARY KEY (id);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: assets assets_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_id_organization_id_key UNIQUE (id, organization_id);


--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: auth_rate_limits auth_rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_rate_limits
    ADD CONSTRAINT auth_rate_limits_pkey PRIMARY KEY (key);


--
-- Name: budgets budgets_building_id_period_currency_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_building_id_period_currency_key UNIQUE (building_id, period, currency);


--
-- Name: budgets budgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_pkey PRIMARY KEY (id);


--
-- Name: buildings buildings_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT buildings_id_organization_id_key UNIQUE (id, organization_id);


--
-- Name: buildings buildings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT buildings_pkey PRIMARY KEY (id);


--
-- Name: charges charges_invoice_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_invoice_id_key UNIQUE (invoice_id);


--
-- Name: charges charges_payer_assignment_id_period_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_payer_assignment_id_period_key UNIQUE (payer_assignment_id, period);


--
-- Name: charges charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_pkey PRIMARY KEY (id);


--
-- Name: defect_history defect_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defect_history
    ADD CONSTRAINT defect_history_pkey PRIMARY KEY (id);


--
-- Name: defects defects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defects
    ADD CONSTRAINT defects_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: documents documents_storage_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_storage_key_key UNIQUE (storage_key);


--
-- Name: entrances entrances_id_building_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrances
    ADD CONSTRAINT entrances_id_building_id_organization_id_key UNIQUE (id, building_id, organization_id);


--
-- Name: entrances entrances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrances
    ADD CONSTRAINT entrances_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: file_attachments file_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_attachments
    ADD CONSTRAINT file_attachments_pkey PRIMARY KEY (id);


--
-- Name: file_attachments file_attachments_storage_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_attachments
    ADD CONSTRAINT file_attachments_storage_key_key UNIQUE (storage_key);


--
-- Name: floors floors_id_building_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.floors
    ADD CONSTRAINT floors_id_building_id_organization_id_key UNIQUE (id, building_id, organization_id);


--
-- Name: floors floors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.floors
    ADD CONSTRAINT floors_pkey PRIMARY KEY (id);


--
-- Name: handover_cases handover_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handover_cases
    ADD CONSTRAINT handover_cases_pkey PRIMARY KEY (id);


--
-- Name: handover_cases handover_cases_unit_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handover_cases
    ADD CONSTRAINT handover_cases_unit_id_key UNIQUE (unit_id);


--
-- Name: import_jobs import_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT import_jobs_pkey PRIMARY KEY (id);


--
-- Name: incidents incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_pkey PRIMARY KEY (id);


--
-- Name: inspections inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_token_hash_key UNIQUE (token_hash);


--
-- Name: invoice_lines invoice_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_id_org_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_id_org_unique UNIQUE (id, organization_id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: leases leases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leases
    ADD CONSTRAINT leases_pkey PRIMARY KEY (id);


--
-- Name: maintenance_plans maintenance_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_plans
    ADD CONSTRAINT maintenance_plans_pkey PRIMARY KEY (id);


--
-- Name: meetings meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_pkey PRIMARY KEY (id);


--
-- Name: memberships memberships_id_user_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_id_user_id_organization_id_key UNIQUE (id, user_id, organization_id);


--
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);


--
-- Name: memberships memberships_user_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_user_id_organization_id_key UNIQUE (user_id, organization_id);


--
-- Name: meter_readings meter_readings_meter_id_period_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_readings
    ADD CONSTRAINT meter_readings_meter_id_period_key UNIQUE (meter_id, period);


--
-- Name: meter_readings meter_readings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_readings
    ADD CONSTRAINT meter_readings_pkey PRIMARY KEY (id);


--
-- Name: meters meters_organization_id_serial_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meters
    ADD CONSTRAINT meters_organization_id_serial_number_key UNIQUE (organization_id, serial_number);


--
-- Name: meters meters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meters
    ADD CONSTRAINT meters_pkey PRIMARY KEY (id);


--
-- Name: mfa_credentials mfa_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_credentials
    ADD CONSTRAINT mfa_credentials_pkey PRIMARY KEY (user_id);


--
-- Name: module_entitlements module_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_entitlements
    ADD CONSTRAINT module_entitlements_pkey PRIMARY KEY (organization_id, module);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: occupancies occupancies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.occupancies
    ADD CONSTRAINT occupancies_pkey PRIMARY KEY (id);


--
-- Name: onboarding_steps onboarding_steps_organization_id_title_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_steps
    ADD CONSTRAINT onboarding_steps_organization_id_title_key UNIQUE (organization_id, title);


--
-- Name: onboarding_steps onboarding_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_steps
    ADD CONSTRAINT onboarding_steps_pkey PRIMARY KEY (id);


--
-- Name: operation_receipts operation_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operation_receipts
    ADD CONSTRAINT operation_receipts_pkey PRIMARY KEY (actor_id, key);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: ownerships ownerships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ownerships
    ADD CONSTRAINT ownerships_pkey PRIMARY KEY (id);


--
-- Name: password_resets password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_pkey PRIMARY KEY (id);


--
-- Name: password_resets password_resets_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_token_hash_key UNIQUE (token_hash);


--
-- Name: payer_assignments payer_assignments_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payer_assignments
    ADD CONSTRAINT payer_assignments_id_organization_id_key UNIQUE (id, organization_id);


--
-- Name: payer_assignments payer_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payer_assignments
    ADD CONSTRAINT payer_assignments_pkey PRIMARY KEY (id);


--
-- Name: payment_allocations payment_allocations_payment_id_invoice_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocations
    ADD CONSTRAINT payment_allocations_payment_id_invoice_id_key UNIQUE (payment_id, invoice_id);


--
-- Name: payment_allocations payment_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocations
    ADD CONSTRAINT payment_allocations_pkey PRIMARY KEY (id);


--
-- Name: payments payments_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_id_organization_id_key UNIQUE (id, organization_id);


--
-- Name: payments payments_organization_id_source_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_organization_id_source_reference_key UNIQUE (organization_id, source, reference);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (key);


--
-- Name: request_history request_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_history
    ADD CONSTRAINT request_history_pkey PRIMARY KEY (id);


--
-- Name: request_messages request_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_messages
    ADD CONSTRAINT request_messages_pkey PRIMARY KEY (id);


--
-- Name: request_photos request_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_photos
    ADD CONSTRAINT request_photos_pkey PRIMARY KEY (id);


--
-- Name: request_photos request_photos_storage_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_photos
    ADD CONSTRAINT request_photos_storage_key_key UNIQUE (storage_key);


--
-- Name: resident_delegations resident_delegations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resident_delegations
    ADD CONSTRAINT resident_delegations_pkey PRIMARY KEY (id);


--
-- Name: resident_requests resident_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resident_requests
    ADD CONSTRAINT resident_requests_pkey PRIMARY KEY (id);


--
-- Name: role_assignments role_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignments
    ADD CONSTRAINT role_assignments_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_key, permission_key);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (key);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (name);


--
-- Name: services services_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_id_organization_id_key UNIQUE (id, organization_id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: subscription_plans subscription_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: support_access_grants support_access_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_access_grants
    ADD CONSTRAINT support_access_grants_pkey PRIMARY KEY (id);


--
-- Name: support_cases support_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_cases
    ADD CONSTRAINT support_cases_pkey PRIMARY KEY (id);


--
-- Name: tariffs tariffs_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariffs
    ADD CONSTRAINT tariffs_id_organization_id_key UNIQUE (id, organization_id);


--
-- Name: tariffs tariffs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariffs
    ADD CONSTRAINT tariffs_pkey PRIMARY KEY (id);


--
-- Name: units units_building_id_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_building_id_number_key UNIQUE (building_id, number);


--
-- Name: units units_id_building_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_id_building_id_organization_id_key UNIQUE (id, building_id, organization_id);


--
-- Name: units units_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_id_organization_id_key UNIQUE (id, organization_id);


--
-- Name: units units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: visitor_passes visitor_passes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_passes
    ADD CONSTRAINT visitor_passes_pkey PRIMARY KEY (id);


--
-- Name: visitor_passes visitor_passes_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_passes
    ADD CONSTRAINT visitor_passes_token_hash_key UNIQUE (token_hash);


--
-- Name: votes votes_agenda_item_id_unit_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_agenda_item_id_unit_id_key UNIQUE (agenda_item_id, unit_id);


--
-- Name: votes votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_pkey PRIMARY KEY (id);


--
-- Name: warranties warranties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warranties
    ADD CONSTRAINT warranties_pkey PRIMARY KEY (id);


--
-- Name: work_orders work_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_pkey PRIMARY KEY (id);


--
-- Name: work_orders work_orders_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_request_id_key UNIQUE (request_id);


--
-- Name: work_reports work_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_reports
    ADD CONSTRAINT work_reports_pkey PRIMARY KEY (id);


--
-- Name: assignments_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assignments_user_idx ON public.role_assignments USING btree (user_id);


--
-- Name: audit_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_org_idx ON public.audit_events USING btree (organization_id, created_at DESC);


--
-- Name: auth_rate_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_rate_expiry ON public.auth_rate_limits USING btree (reset_at);


--
-- Name: delegation_assignment_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX delegation_assignment_unique ON public.resident_delegations USING btree (assignment_id) WHERE (assignment_id IS NOT NULL);


--
-- Name: request_history_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX request_history_request ON public.request_history USING btree (request_id, created_at);


--
-- Name: session_expire_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_expire_idx ON public.session USING btree (expire);


--
-- Name: access_events access_history_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER access_history_guard BEFORE DELETE OR UPDATE ON public.access_events FOR EACH ROW EXECUTE FUNCTION public.protect_request_history();


--
-- Name: adjustments adjustment_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER adjustment_immutable BEFORE DELETE OR UPDATE ON public.adjustments FOR EACH ROW EXECUTE FUNCTION public.immutable_ledger();


--
-- Name: payment_allocations allocation_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER allocation_immutable BEFORE DELETE OR UPDATE ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION public.immutable_ledger();


--
-- Name: defect_history defect_history_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER defect_history_guard BEFORE DELETE OR UPDATE ON public.defect_history FOR EACH ROW EXECUTE FUNCTION public.protect_request_history();


--
-- Name: invoice_lines invoice_lines_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invoice_lines_guard BEFORE INSERT OR DELETE OR UPDATE ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION public.immutable_invoice_line();


--
-- Name: invoices invoices_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invoices_immutable BEFORE DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.immutable_published_invoice();


--
-- Name: payments payment_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payment_immutable BEFORE DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.immutable_ledger();


--
-- Name: request_history request_history_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER request_history_append_only BEFORE DELETE OR UPDATE ON public.request_history FOR EACH ROW EXECUTE FUNCTION public.protect_request_history();


--
-- Name: request_history request_notifications; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER request_notifications AFTER INSERT ON public.request_history FOR EACH ROW EXECUTE FUNCTION public.notify_request_transition();


--
-- Name: work_reports work_report_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER work_report_guard BEFORE DELETE OR UPDATE ON public.work_reports FOR EACH ROW EXECUTE FUNCTION public.protect_request_history();


--
-- Name: access_events access_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_events
    ADD CONSTRAINT access_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: access_events access_events_pass_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_events
    ADD CONSTRAINT access_events_pass_id_fkey FOREIGN KEY (pass_id) REFERENCES public.visitor_passes(id);


--
-- Name: adjustments adjustments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adjustments
    ADD CONSTRAINT adjustments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: adjustments adjustments_invoice_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adjustments
    ADD CONSTRAINT adjustments_invoice_id_organization_id_fkey FOREIGN KEY (invoice_id, organization_id) REFERENCES public.invoices(id, organization_id);


--
-- Name: agenda_items agenda_items_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_items
    ADD CONSTRAINT agenda_items_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id);


--
-- Name: announcements announcements_building_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_building_id_organization_id_fkey FOREIGN KEY (building_id, organization_id) REFERENCES public.buildings(id, organization_id);


--
-- Name: announcements announcements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: assets assets_building_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_building_id_organization_id_fkey FOREIGN KEY (building_id, organization_id) REFERENCES public.buildings(id, organization_id);


--
-- Name: audit_events audit_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: audit_events audit_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: budgets budgets_building_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_building_id_organization_id_fkey FOREIGN KEY (building_id, organization_id) REFERENCES public.buildings(id, organization_id);


--
-- Name: budgets budgets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: buildings buildings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT buildings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: charges charges_invoice_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_invoice_id_organization_id_fkey FOREIGN KEY (invoice_id, organization_id) REFERENCES public.invoices(id, organization_id);


--
-- Name: charges charges_payer_assignment_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_payer_assignment_id_organization_id_fkey FOREIGN KEY (payer_assignment_id, organization_id) REFERENCES public.payer_assignments(id, organization_id);


--
-- Name: charges charges_tariff_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_tariff_id_organization_id_fkey FOREIGN KEY (tariff_id, organization_id) REFERENCES public.tariffs(id, organization_id);


--
-- Name: defect_history defect_history_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defect_history
    ADD CONSTRAINT defect_history_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: defect_history defect_history_defect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defect_history
    ADD CONSTRAINT defect_history_defect_id_fkey FOREIGN KEY (defect_id) REFERENCES public.defects(id);


--
-- Name: defects defects_contractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defects
    ADD CONSTRAINT defects_contractor_id_fkey FOREIGN KEY (contractor_id) REFERENCES public.users(id);


--
-- Name: defects defects_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defects
    ADD CONSTRAINT defects_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: defects defects_unit_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defects
    ADD CONSTRAINT defects_unit_id_organization_id_fkey FOREIGN KEY (unit_id, organization_id) REFERENCES public.units(id, organization_id);


--
-- Name: documents documents_building_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_building_id_organization_id_fkey FOREIGN KEY (building_id, organization_id) REFERENCES public.buildings(id, organization_id);


--
-- Name: documents documents_unit_id_building_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_unit_id_building_id_organization_id_fkey FOREIGN KEY (unit_id, building_id, organization_id) REFERENCES public.units(id, building_id, organization_id);


--
-- Name: documents documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: entrances entrances_building_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrances
    ADD CONSTRAINT entrances_building_id_organization_id_fkey FOREIGN KEY (building_id, organization_id) REFERENCES public.buildings(id, organization_id);


--
-- Name: expenses expenses_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: expenses expenses_building_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_building_id_organization_id_fkey FOREIGN KEY (building_id, organization_id) REFERENCES public.buildings(id, organization_id);


--
-- Name: expenses expenses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: file_attachments file_attachments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_attachments
    ADD CONSTRAINT file_attachments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: file_attachments file_attachments_defect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_attachments
    ADD CONSTRAINT file_attachments_defect_id_fkey FOREIGN KEY (defect_id) REFERENCES public.defects(id);


--
-- Name: floors floors_entrance_id_building_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.floors
    ADD CONSTRAINT floors_entrance_id_building_id_organization_id_fkey FOREIGN KEY (entrance_id, building_id, organization_id) REFERENCES public.entrances(id, building_id, organization_id);


--
-- Name: handover_cases handover_cases_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handover_cases
    ADD CONSTRAINT handover_cases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: handover_cases handover_cases_unit_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handover_cases
    ADD CONSTRAINT handover_cases_unit_id_organization_id_fkey FOREIGN KEY (unit_id, organization_id) REFERENCES public.units(id, organization_id);


--
-- Name: import_jobs import_jobs_building_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT import_jobs_building_id_organization_id_fkey FOREIGN KEY (building_id, organization_id) REFERENCES public.buildings(id, organization_id);


--
-- Name: import_jobs import_jobs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT import_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: incidents incidents_building_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_building_id_organization_id_fkey FOREIGN KEY (building_id, organization_id) REFERENCES public.buildings(id, organization_id);


--
-- Name: incidents incidents_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: inspections inspections_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.users(id);


--
-- Name: inspections inspections_handover_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_handover_id_fkey FOREIGN KEY (handover_id) REFERENCES public.handover_cases(id);


--
-- Name: invitations invitations_building_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_building_id_organization_id_fkey FOREIGN KEY (building_id, organization_id) REFERENCES public.buildings(id, organization_id);


--
-- Name: invitations invitations_delegation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_delegation_id_fkey FOREIGN KEY (delegation_id) REFERENCES public.resident_delegations(id);


--
-- Name: invitations invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id);


--
-- Name: invitations invitations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: invitations invitations_role_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_role_key_fkey FOREIGN KEY (role_key) REFERENCES public.roles(key);


--
-- Name: invitations invitations_unit_id_building_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_unit_id_building_id_organization_id_fkey FOREIGN KEY (unit_id, building_id, organization_id) REFERENCES public.units(id, building_id, organization_id);


--
-- Name: invoice_lines invoice_lines_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);


--
-- Name: invoices invoices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: invoices invoices_payer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_payer_user_id_fkey FOREIGN KEY (payer_user_id) REFERENCES public.users(id);


--
-- Name: invoices invoices_published_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_published_by_fkey FOREIGN KEY (published_by) REFERENCES public.users(id);


--
-- Name: invoices invoices_unit_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_unit_id_organization_id_fkey FOREIGN KEY (unit_id, organization_id) REFERENCES public.units(id, organization_id);


--
-- Name: leases leases_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leases
    ADD CONSTRAINT leases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: leases leases_renter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leases
    ADD CONSTRAINT leases_renter_id_fkey FOREIGN KEY (renter_id) REFERENCES public.users(id);


--
-- Name: leases leases_unit_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leases
    ADD CONSTRAINT leases_unit_id_organization_id_fkey FOREIGN KEY (unit_id, organization_id) REFERENCES public.units(id, organization_id);


--
-- Name: maintenance_plans maintenance_plans_asset_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_plans
    ADD CONSTRAINT maintenance_plans_asset_id_organization_id_fkey FOREIGN KEY (asset_id, organization_id) REFERENCES public.assets(id, organization_id);


--
-- Name: maintenance_plans maintenance_plans_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_plans
    ADD CONSTRAINT maintenance_plans_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.users(id);


--
-- Name: meetings meetings_building_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_building_id_organization_id_fkey FOREIGN KEY (building_id, organization_id) REFERENCES public.buildings(id, organization_id);


--
-- Name: meetings meetings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: memberships memberships_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: memberships memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: meter_readings meter_readings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_readings
    ADD CONSTRAINT meter_readings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: meter_readings meter_readings_meter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_readings
    ADD CONSTRAINT meter_readings_meter_id_fkey FOREIGN KEY (meter_id) REFERENCES public.meters(id);


--
-- Name: meters meters_unit_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meters
    ADD CONSTRAINT meters_unit_id_organization_id_fkey FOREIGN KEY (unit_id, organization_id) REFERENCES public.units(id, organization_id);


--
-- Name: mfa_credentials mfa_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_credentials
    ADD CONSTRAINT mfa_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: module_entitlements module_entitlements_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_entitlements
    ADD CONSTRAINT module_entitlements_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: notifications notifications_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: occupancies occupancies_unit_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.occupancies
    ADD CONSTRAINT occupancies_unit_id_organization_id_fkey FOREIGN KEY (unit_id, organization_id) REFERENCES public.units(id, organization_id);


--
-- Name: occupancies occupancies_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.occupancies
    ADD CONSTRAINT occupancies_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: onboarding_steps onboarding_steps_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_steps
    ADD CONSTRAINT onboarding_steps_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: onboarding_steps onboarding_steps_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_steps
    ADD CONSTRAINT onboarding_steps_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: operation_receipts operation_receipts_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operation_receipts
    ADD CONSTRAINT operation_receipts_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: ownerships ownerships_unit_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ownerships
    ADD CONSTRAINT ownerships_unit_id_organization_id_fkey FOREIGN KEY (unit_id, organization_id) REFERENCES public.units(id, organization_id);


--
-- Name: ownerships ownerships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ownerships
    ADD CONSTRAINT ownerships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: password_resets password_resets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: payer_assignments payer_assignments_payer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payer_assignments
    ADD CONSTRAINT payer_assignments_payer_user_id_fkey FOREIGN KEY (payer_user_id) REFERENCES public.users(id);


--
-- Name: payer_assignments payer_assignments_service_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payer_assignments
    ADD CONSTRAINT payer_assignments_service_id_organization_id_fkey FOREIGN KEY (service_id, organization_id) REFERENCES public.services(id, organization_id);


--
-- Name: payer_assignments payer_assignments_unit_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payer_assignments
    ADD CONSTRAINT payer_assignments_unit_id_organization_id_fkey FOREIGN KEY (unit_id, organization_id) REFERENCES public.units(id, organization_id);


--
-- Name: payment_allocations payment_allocations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocations
    ADD CONSTRAINT payment_allocations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: payment_allocations payment_allocations_invoice_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocations
    ADD CONSTRAINT payment_allocations_invoice_id_organization_id_fkey FOREIGN KEY (invoice_id, organization_id) REFERENCES public.invoices(id, organization_id);


--
-- Name: payment_allocations payment_allocations_payment_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocations
    ADD CONSTRAINT payment_allocations_payment_id_organization_id_fkey FOREIGN KEY (payment_id, organization_id) REFERENCES public.payments(id, organization_id);


--
-- Name: payments payments_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.users(id);


--
-- Name: payments payments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: payments payments_payer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_payer_user_id_fkey FOREIGN KEY (payer_user_id) REFERENCES public.users(id);


--
-- Name: request_history request_history_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_history
    ADD CONSTRAINT request_history_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: request_history request_history_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_history
    ADD CONSTRAINT request_history_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.resident_requests(id);


--
-- Name: request_messages request_messages_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_messages
    ADD CONSTRAINT request_messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: request_messages request_messages_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_messages
    ADD CONSTRAINT request_messages_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.resident_requests(id);


--
-- Name: request_photos request_photos_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_photos
    ADD CONSTRAINT request_photos_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: request_photos request_photos_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_photos
    ADD CONSTRAINT request_photos_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.resident_requests(id);


--
-- Name: resident_delegations resident_delegations_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resident_delegations
    ADD CONSTRAINT resident_delegations_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.role_assignments(id);


--
-- Name: resident_delegations resident_delegations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resident_delegations
    ADD CONSTRAINT resident_delegations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: resident_delegations resident_delegations_owner_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resident_delegations
    ADD CONSTRAINT resident_delegations_owner_assignment_id_fkey FOREIGN KEY (owner_assignment_id) REFERENCES public.role_assignments(id);


--
-- Name: resident_delegations resident_delegations_unit_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resident_delegations
    ADD CONSTRAINT resident_delegations_unit_id_organization_id_fkey FOREIGN KEY (unit_id, organization_id) REFERENCES public.units(id, organization_id);


--
-- Name: resident_requests resident_requests_author_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resident_requests
    ADD CONSTRAINT resident_requests_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES public.users(id);


--
-- Name: resident_requests resident_requests_unit_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resident_requests
    ADD CONSTRAINT resident_requests_unit_id_organization_id_fkey FOREIGN KEY (unit_id, organization_id) REFERENCES public.units(id, organization_id);


--
-- Name: role_assignments role_assignments_building_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignments
    ADD CONSTRAINT role_assignments_building_id_organization_id_fkey FOREIGN KEY (building_id, organization_id) REFERENCES public.buildings(id, organization_id);


--
-- Name: role_assignments role_assignments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignments
    ADD CONSTRAINT role_assignments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: role_assignments role_assignments_role_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignments
    ADD CONSTRAINT role_assignments_role_key_fkey FOREIGN KEY (role_key) REFERENCES public.roles(key);


--
-- Name: role_assignments role_assignments_unit_id_building_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignments
    ADD CONSTRAINT role_assignments_unit_id_building_id_organization_id_fkey FOREIGN KEY (unit_id, building_id, organization_id) REFERENCES public.units(id, building_id, organization_id);


--
-- Name: role_assignments role_assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignments
    ADD CONSTRAINT role_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: role_assignments role_assignments_user_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignments
    ADD CONSTRAINT role_assignments_user_id_organization_id_fkey FOREIGN KEY (user_id, organization_id) REFERENCES public.memberships(user_id, organization_id);


--
-- Name: role_permissions role_permissions_permission_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_key_fkey FOREIGN KEY (permission_key) REFERENCES public.permissions(key);


--
-- Name: role_permissions role_permissions_role_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_key_fkey FOREIGN KEY (role_key) REFERENCES public.roles(key);


--
-- Name: services services_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: subscriptions subscriptions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: subscriptions subscriptions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: subscriptions subscriptions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id);


--
-- Name: support_access_grants support_access_grants_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_access_grants
    ADD CONSTRAINT support_access_grants_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: support_access_grants support_access_grants_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_access_grants
    ADD CONSTRAINT support_access_grants_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: support_access_grants support_access_grants_support_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_access_grants
    ADD CONSTRAINT support_access_grants_support_user_id_fkey FOREIGN KEY (support_user_id) REFERENCES public.users(id);


--
-- Name: support_cases support_cases_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_cases
    ADD CONSTRAINT support_cases_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: support_cases support_cases_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_cases
    ADD CONSTRAINT support_cases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: support_cases support_cases_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_cases
    ADD CONSTRAINT support_cases_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: tariffs tariffs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariffs
    ADD CONSTRAINT tariffs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: tariffs tariffs_service_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariffs
    ADD CONSTRAINT tariffs_service_id_organization_id_fkey FOREIGN KEY (service_id, organization_id) REFERENCES public.services(id, organization_id);


--
-- Name: units units_building_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_building_id_organization_id_fkey FOREIGN KEY (building_id, organization_id) REFERENCES public.buildings(id, organization_id);


--
-- Name: visitor_passes visitor_passes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_passes
    ADD CONSTRAINT visitor_passes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: visitor_passes visitor_passes_unit_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_passes
    ADD CONSTRAINT visitor_passes_unit_id_organization_id_fkey FOREIGN KEY (unit_id, organization_id) REFERENCES public.units(id, organization_id);


--
-- Name: votes votes_agenda_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_agenda_item_id_fkey FOREIGN KEY (agenda_item_id) REFERENCES public.agenda_items(id);


--
-- Name: votes votes_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id);


--
-- Name: votes votes_voter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_voter_id_fkey FOREIGN KEY (voter_id) REFERENCES public.users(id);


--
-- Name: warranties warranties_unit_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warranties
    ADD CONSTRAINT warranties_unit_id_organization_id_fkey FOREIGN KEY (unit_id, organization_id) REFERENCES public.units(id, organization_id);


--
-- Name: work_orders work_orders_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: work_orders work_orders_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.resident_requests(id);


--
-- Name: work_orders work_orders_technician_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_technician_id_fkey FOREIGN KEY (technician_id) REFERENCES public.users(id);


--
-- Name: work_reports work_reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_reports
    ADD CONSTRAINT work_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id);


--
-- Name: work_reports work_reports_work_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_reports
    ADD CONSTRAINT work_reports_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES public.work_orders(id);


--
-- PostgreSQL database dump complete
--

\unrestrict pxXqbjWte3PfjrjIu4KhPYXtGGuzdQvnl2p0gKn5KI0nN5ZVtZbdQGja5ie3faH

