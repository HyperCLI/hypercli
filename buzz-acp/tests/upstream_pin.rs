use std::collections::BTreeSet;

#[test]
fn all_buzz_dependencies_share_the_documented_upstream_pin() {
    let manifest: toml::Value = toml::from_str(include_str!("../Cargo.toml")).unwrap();
    let expected = manifest["package"]["metadata"]["hypercli"]["upstream-buzz-ref"]
        .as_str()
        .unwrap();
    assert_eq!(expected.len(), 40);
    assert!(expected.bytes().all(|byte| byte.is_ascii_hexdigit()));

    let dependencies = manifest["dependencies"].as_table().unwrap();
    let pins = ["buzz-core", "buzz-sdk", "buzz-persona"]
        .into_iter()
        .map(|name| dependencies[name]["rev"].as_str().unwrap())
        .collect::<BTreeSet<_>>();
    assert_eq!(pins, BTreeSet::from([expected]));
}
