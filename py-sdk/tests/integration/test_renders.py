from __future__ import annotations


def test_list_renders(client):
    renders = client.renders.list()

    assert isinstance(renders, list)
    if renders:
        render = renders[0]
        assert render.render_id
        assert render.state
