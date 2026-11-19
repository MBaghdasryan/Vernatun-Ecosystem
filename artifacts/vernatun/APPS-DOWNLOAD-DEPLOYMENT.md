# Vernatun Apps download files

The public page uses permanent, same-domain paths:

- `/downloads/ImTun_app_by_Vernatun.apk`
- `/downloads/Hayat_app_by_Vernatun.apk`

The APK files are intentionally excluded from Git. In this Replit workspace,
the verified copies are in `public/downloads/` and Vite serves them locally.
For Coolify, upload the APKs into the Vernatun website's checkout before its
build, at:

```text
artifacts/vernatun/public/downloads/ImTun_app_by_Vernatun.apk
artifacts/vernatun/public/downloads/Hayat_app_by_Vernatun.apk
```

If the website checkout is `/app`, the corresponding full paths are
`/app/artifacts/vernatun/public/downloads/...`. Confirm the checkout path in
the Coolify service before uploading. The static build copies these files to
`artifacts/vernatun/dist/public/downloads/`; the web server must serve that
directory as the site's document root. Do not upload them to a temporary
Replit URL or commit them to Git.

For the Coolify Nginx site, make sure the APK location uses this response
configuration (merge it into the existing site's Nginx config rather than
replacing the whole config):

```nginx
location ~* ^/downloads/(ImTun_app_by_Vernatun|Hayat_app_by_Vernatun)\.apk$ {
    default_type application/vnd.android.package-archive;
    add_header Content-Disposition "attachment";
    try_files $uri =404;
}
```

The included `.htaccess` covers Apache-based static hosting. Replit's
development server also sets the APK MIME type and attachment filename.

Before building or replacing the APKs, verify both checksums:

```sh
cd /app
sha256sum artifacts/vernatun/public/downloads/ImTun_app_by_Vernatun.apk \
  artifacts/vernatun/public/downloads/Hayat_app_by_Vernatun.apk
```

Current reference SHA-256 values:

```text
ImTun  25cce6fd3c0649878a0a39d4c85fa267f509af787d3f2aefb2d3fd8b02d85f30
HAYAT  d0b2b51f4c657fbfb6fea2b6d3c25a579bdf9390c2bc24f63e9a9e0c0fda54da
```

For a new app release, keep the same two filenames, replace the files in the
Coolify build checkout, verify their new hashes, rebuild, then verify the
download URLs return the expected APK bytes and
`application/vnd.android.package-archive`. The current Coolify storage and
upload process were not accessible from this workspace; arrange persistent
storage or repeat the upload before each build so subsequent deployments do
not remove the APKs.
