from apps.base.tests import BaseTest


class TestErrorPages(BaseTest):
    def test_missing_page_renders_404_not_500(self):
        # 404.html extends layouts/base.html, which includes nav.html — so a stale {% url %}
        # in that chain turns every Http404 in the project into a 500.
        response = self.client.get("/no-such-page-exists/")
        self.assertEqual(response.status_code, 404)


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
