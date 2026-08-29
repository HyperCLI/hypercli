use crate::types::PlatformCommand;

pub fn platform_command_from_chat(command: &str) -> Option<PlatformCommand> {
    match command.trim() {
        "!cancel" => Some(PlatformCommand::TurnCancel),
        "!rotate" => Some(PlatformCommand::SessionRotate),
        "!shutdown" => Some(PlatformCommand::RuntimeShutdown),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_commands_map_to_platform_commands() {
        assert_eq!(
            platform_command_from_chat(" !cancel "),
            Some(PlatformCommand::TurnCancel)
        );
        assert_eq!(
            platform_command_from_chat("!rotate"),
            Some(PlatformCommand::SessionRotate)
        );
        assert_eq!(
            platform_command_from_chat("!shutdown"),
            Some(PlatformCommand::RuntimeShutdown)
        );
        assert_eq!(platform_command_from_chat("!status"), None);
    }
}
