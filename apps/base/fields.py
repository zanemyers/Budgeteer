from django.conf import settings
from django.db import models

from cryptography.fernet import Fernet


def _fernet() -> Fernet:
    return Fernet(settings.FERNET_KEY.encode())


class EncryptedTextField(models.BinaryField):
    description = "Text encrypted at rest with Fernet (settings.FERNET_KEY)."

    def from_db_value(self, value, expression, connection):
        if value is None:
            return None
        return _fernet().decrypt(bytes(value)).decode()

    def to_python(self, value):
        if value is None or isinstance(value, str):
            return value
        return _fernet().decrypt(bytes(value)).decode()

    def get_prep_value(self, value):
        if value is None:
            return None
        return _fernet().encrypt(value.encode())
