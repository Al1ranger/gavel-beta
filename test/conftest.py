"""Windows compatibility for gltest's POSIX unlink-after-dup2 test loader."""
import os
import pytest


@pytest.fixture(scope="session", autouse=True)
def windows_direct_stdin():
    if os.name != "nt":
        yield
        return
    from gltest.direct import loader
    original = loader._inject_message_to_fd0
    pending = []

    def inject(vm):
        try:
            original(vm)
        except PermissionError as error:
            # fd 0 was successfully installed; Windows prevents unlinking its
            # backing file until VM teardown restores the original stdin.
            if error.winerror != 32 or not getattr(vm, "_original_stdin_fd", None):
                raise
            pending.append(error.filename)

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(loader, "_inject_message_to_fd0", inject)
        yield
    for path in pending:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
