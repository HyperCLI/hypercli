from __future__ import annotations


def test_list_gpu_types(client):
    types = client.instances.types(refresh=True)

    assert types
    first = next(iter(types.values()))
    assert first.id
    assert first.name
    assert isinstance(first.configs, list)


def test_list_regions(client):
    regions = client.instances.regions(refresh=True)

    assert regions
    first = next(iter(regions.values()))
    assert first.id
    assert first.description
    assert first.country
