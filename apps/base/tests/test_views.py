from django.template.loader import render_to_string

from apps.base.tests import BaseTest


class TestErrorPages(BaseTest):
    def test_missing_page_renders_404_not_500(self):
        # 404.html extends layouts/standalone.html, which resolves the Vite manifest — so a break
        # anywhere in that chain turns every Http404 in the project into a 500.
        response = self.client.get("/no-such-page-exists/")
        self.assertEqual(response.status_code, 404)

    def test_error_pages_render_on_the_app_shell(self):
        # They used to extend a pre-Inertia layout that included a Bootstrap 5 sidebar, long after
        # Bootstrap stopped being a dependency: undefined layout classes and dead data-bs-* handlers
        # on the one page a lost user actually sees.
        for template in ("404.html", "500.html"):
            with self.subTest(template=template):
                html = render_to_string(template)
                self.assertIn('class="standalone"', html)
                self.assertNotIn("data-bs-", html)
                self.assertNotIn("offcanvas", html)
                # A route back into the app, rather than a dead end.
                self.assertIn('href="/"', html)

    def test_500_renders_with_no_context_at_all(self):
        """
        Django's handler500 renders with an empty context — no request, no context processors.

        So a {{ }} the template depends on resolves to nothing and a tag that needs the request
        raises, which would turn every server error into a bare Django fallback page.
        """
        html = render_to_string("500.html")
        self.assertIn("Something went wrong", html)


class TestLegacyAccountUrls(BaseTest):
    """
    Allauth's own email and password pages are shadowed by redirects into AccountSettings.

    Unshadowed they stayed reachable and rendered a second, older account UI on the retired
    pre-Inertia shell — duplicating the Email addresses and Password rows the settings page already
    owns.
    """

    def test_legacy_account_pages_redirect_into_account_settings(self):
        user = self.make_user()
        with self.login(user):
            for url in ("/accounts/email/", "/accounts/password/change/", "/accounts/password/set/"):
                with self.subTest(url=url):
                    response = self.client.get(url)
                    self.assertRedirects(response, "/accounts/settings/")

    def test_the_url_names_still_reverse(self):
        # Allauth reverses these internally, and old links in already-sent emails point at them.
        from django.urls import reverse

        for name in ("account_email", "account_change_password", "account_set_password"):
            with self.subTest(name=name):
                self.assertTrue(reverse(name))


class TestIndexView(BaseTest):
    def test_anonymous_visitor_gets_the_public_landing_page(self):
        # Signup is intentionally open, so "/" renders Landing rather than bouncing to login.
        self.get("site_index")
        self.assert_http_200_ok()

    def test_member_is_redirected_to_their_budget(self):
        user = self.make_user()
        with self.login(user):
            self.get("site_index")
            self.assert_http_302_found()
