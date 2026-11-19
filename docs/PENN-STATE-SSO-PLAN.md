# Penn State sign-in path for Kelvin

Status: research and integration plan, 2026-11-19. No Penn State SSO registration or code integration has been completed.

## What Penn State documents

Penn State's [WebSSO service](https://security.psu.edu/services/authentication-authorization/web-single-sign-on/) is managed by Identity and Access Management and uses Microsoft's Azure/Entra SSO for new web applications. The [WebSSO implementation article](https://pennstate.service-now.com/kb_view.do?sysparm_article=KB0015174) points new applications to an [Azure SSO App Registration Request](https://pennstate.service-now.com/sp?id=sc_cat_item&sys_id=3001da3d1baa5cd06d6765302a4bcb33). It also offers a [general request](https://pennstate.service-now.com/sp?id=sc_cat_item&sys_id=63aefab91bee5cd06d6765302a4bcbde) for help choosing an integration method. Detailed Penn State implementation guides are on a SharePoint site that requires a Penn State sign-in.

This is an application identity request. The GB10 itself does not provide SSO automatically. Kelvin must be registered with IAM and implement the approved sign-in flow.

## Recommended design to review with IAM

1. Ask the WebSSO team to register Kelvin as a web application for `kelvin.me.psu.edu`, using OpenID Connect authorization code flow with PKCE if Penn State permits it. Confirm that this is the method they want for a student-facing external MCP service.
2. Give IAM a proposed callback such as `https://kelvin.me.psu.edu/auth/psu/callback` and a sign-out URL. Obtain the tenant/issuer, client ID, approved redirect URI, permitted claims, and credential handling instructions. Store any client secret only on the GB10 as a host secret, never in Git.
3. At Kelvin's current OAuth login page, redirect the browser to Penn State sign-in. Verify the returned ID token's issuer, audience, signature, nonce, and expiry. Map a stable Penn State identity claim to one Kelvin account. Do not use an unverified email string as the account key.
4. Keep Kelvin's existing MCP OAuth issuer. After Penn State verifies the person's identity, Kelvin can still let the student choose a course and issue the MCP authorization code/token to Claude, ChatGPT, or Gemini. The dashboard can use the same Penn State identity for its session.
5. Assign instructor, researcher, and operator roles from an explicit Kelvin allowlist or a Penn State-approved group claim. A `@psu.edu` address by itself must not grant a privileged role.
6. Test with a student, instructor, and operator account; check token refresh, sign-out, role changes, and whether the MCP client can reach the public HTTPS endpoint from outside the campus/VPN.

## Questions for Gary and IAM

- Who is the application owner and who may submit the Azure SSO registration request?
- Will IAM approve OIDC for Kelvin, and which claims identify students reliably?
- Is this pilot allowed to use Penn State SSO while the student chat clients are external services?
- What data classification, consent, retention, and privacy review applies to course activity and imported chats?
- Can the registered app use the public `kelvin.me.psu.edu` callback and the current NGINX routing?
- Which group or process should authorize instructor and operator roles?

Until IAM answers these, keep the current pilot login clearly labeled as unverified. Do not claim that typing a PSU email is Penn State SSO.
