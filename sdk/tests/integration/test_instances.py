from __future__ import annotations


def test_list_gpu_types(client):
    types = client.instances.types(refresh=True)

    assert types
    assert any(name in types for name in ("l4", "l40s", "b200", "h200"))
    first = next(iter(types.values()))
    assert first.id
    assert first.name
    assert isinstance(first.configs, list)


def test_list_regions(client):
    regions = client.instances.regions(refresh=True)

    assert regions
    assert any(name in regions for name in ("oh", "va", "fi"))
    first = next(iter(regions.values()))
    assert first.id
    assert first.description
    assert first.country
