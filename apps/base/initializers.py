from cryptography.fernet import Fernet


def fernet_key() -> str:
    return Fernet.generate_key().decode()
