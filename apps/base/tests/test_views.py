from apps.base.tests import BaseTest


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
