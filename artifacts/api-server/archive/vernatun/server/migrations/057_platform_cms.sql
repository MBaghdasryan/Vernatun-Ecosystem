CREATE TABLE platform_cms_brand_settings(
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),
 draft_settings jsonb NOT NULL DEFAULT '{"brandName":"Vernatun","primaryColor":"#0b2230","accentColor":"#ff6b0a","logoUrl":null}',
 published_settings jsonb,
 draft_version integer NOT NULL DEFAULT 1 CHECK(draft_version>0),
 published_version integer,
 updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz,
 CHECK(jsonb_typeof(draft_settings)='object'),
 CHECK(published_settings IS NULL OR jsonb_typeof(published_settings)='object'),
 CHECK((published_settings IS NULL)=(published_version IS NULL))
);

INSERT INTO platform_cms_brand_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;

CREATE TABLE platform_cms_pages(
 slug text PRIMARY KEY CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug)<=80),
 draft_content jsonb NOT NULL CHECK(jsonb_typeof(draft_content)='object'),
 published_content jsonb,
 draft_version integer NOT NULL DEFAULT 1 CHECK(draft_version>0),
 published_version integer,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz,
 CHECK(published_content IS NULL OR jsonb_typeof(published_content)='object'),
 CHECK((published_content IS NULL)=(published_version IS NULL))
);

CREATE INDEX platform_cms_pages_updated ON platform_cms_pages(updated_at DESC,slug);

INSERT INTO platform_cms_pages(slug,draft_content) VALUES
 ('privacy',$cms${"hy":{"title":"Գաղտնիության քաղաքականություն","summary":"Vernatun-ի գաղտնիության քաղաքականության աշխատանքային նախագիծ։","body":"Այս փաստաթուղթը նկարագրում է, թե ինչ տվյալներ կարող են մշակվել կայքից և շենքի կառավարման ծառայություններից օգտվելիս։ Նախքան հրապարակումը նշեք տվյալների օպերատորի իրավաբանական անվանումը, կապի տվյալները, պահպանման ժամկետները և կիրառելի իրավական հիմքերը։"},"ru":{"title":"Политика конфиденциальности","summary":"Рабочий черновик политики конфиденциальности Vernatun.","body":"Этот документ описывает, какие данные могут обрабатываться при использовании сайта и сервисов управления домом. Перед публикацией укажите юридическое наименование оператора, контактные данные, сроки хранения и применимые правовые основания."},"en":{"title":"Privacy policy","summary":"Working draft of Vernatun's privacy policy.","body":"This document describes information that may be processed when using the website and building-management services. Before publication, identify the data controller, contact details, retention periods, and applicable legal bases."}}$cms$::jsonb),
 ('terms',$cms${"hy":{"title":"Օգտագործման պայմաններ","summary":"Vernatun ծառայությունների օգտագործման պայմանների աշխատանքային նախագիծ։","body":"Այս պայմանները ներկայացնում են Vernatun կայքի և հարակից թվային ծառայությունների օգտագործման հիմնական կանոնները։ Հրապարակումից առաջ ստուգեք պայմանագրի կողմերը, վճարման պայմանները, կիրառելի իրավունքը և կապի տվյալները։"},"ru":{"title":"Условия использования","summary":"Рабочий черновик условий использования сервисов Vernatun.","body":"Эти условия описывают основные правила использования сайта Vernatun и связанных цифровых сервисов. Перед публикацией проверьте стороны договора, условия оплаты, применимое право и контактные данные."},"en":{"title":"Terms of use","summary":"Working draft of Vernatun service terms.","body":"These terms describe the basic rules for using the Vernatun website and related digital services. Before publication, confirm the contracting parties, payment terms, governing law, and contact details."}}$cms$::jsonb)
ON CONFLICT(slug) DO NOTHING;

INSERT INTO permissions(key) VALUES('platform.cms.manage') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key)
 VALUES('platform_admin','platform.cms.manage') ON CONFLICT DO NOTHING;
