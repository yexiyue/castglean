use super::*;

fn record() -> DiagnosticRecord {
    let (_root, state, draft) = super::super::tests::fixture();
    state.read(&draft).unwrap().diagnostics.remove(0)
}

#[test]
fn changed_binding_requires_confirmation() {
    let previous = record();
    for selected in [
        ModelSelection {
            connection_id: "another-connection".into(),
            ..previous.selection.clone()
        },
        ModelSelection {
            model_id: "another-model".into(),
            ..previous.selection.clone()
        },
    ] {
        assert_eq!(
            validate_binding(Some(&previous), &selected, 1, 1, false),
            Err(LlmError::Conflict)
        );
    }
}

#[test]
fn changed_revision_requires_confirmation() {
    let previous = record();
    assert_eq!(
        validate_binding(Some(&previous), &previous.selection, 2, 2, false),
        Err(LlmError::Conflict)
    );
}

#[test]
fn confirmed_binding_accepts_selected_model_and_revision_without_changing_history() {
    let mut previous = record();
    super::super::budget::reserve_request(&mut previous, 1024).unwrap();
    let before = serde_json::to_value(&previous).unwrap();
    let selected = ModelSelection {
        connection_id: "another-connection".into(),
        model_id: "another-model".into(),
    };
    assert_eq!(
        validate_binding(Some(&previous), &selected, 2, 2, true),
        Ok(())
    );
    assert_eq!(serde_json::to_value(previous).unwrap(), before);
}

#[test]
fn confirmation_cannot_accept_configuration_changed_after_user_confirmation() {
    let previous = record();
    assert_eq!(
        validate_binding(Some(&previous), &previous.selection, 3, 2, true),
        Err(LlmError::Conflict)
    );
}

#[test]
fn unchanged_binding_does_not_require_confirmation() {
    let previous = record();
    assert_eq!(
        validate_binding(Some(&previous), &previous.selection, 1, 1, false),
        Ok(())
    );
}

#[test]
fn new_session_requires_expected_revision_but_not_rebind_confirmation() {
    let selected = record().selection;
    assert_eq!(validate_binding(None, &selected, 2, 2, false), Ok(()));
    assert_eq!(
        validate_binding(None, &selected, 3, 2, false),
        Err(LlmError::Conflict)
    );
}

#[test]
fn cancellation_rechecks_terminal_state_inside_transaction() {
    let (_root, state, draft) = super::super::tests::fixture();
    let stale = state.read(&draft).unwrap().diagnostics.remove(0);
    let token = CancellationToken::new();
    state
        .running
        .lock()
        .unwrap()
        .insert(draft.clone(), token.clone());
    for status in [
        DiagnosticStatus::WaitingForInput,
        DiagnosticStatus::Failed,
        DiagnosticStatus::Cancelled,
        DiagnosticStatus::Interrupted,
    ] {
        // The caller already observed Running, but completion wins before the cancel transaction.
        state
            .update(&draft, None, |r| {
                record_mut(r, &stale.id)?.status = status;
                Ok(())
            })
            .unwrap();
        cancel_run(&state, &draft, &stale.id, &stale.run_id).unwrap();
        assert_eq!(state.read(&draft).unwrap().diagnostics[0].status, status);
        assert!(!token.is_cancelled());
    }
}

#[test]
fn stale_run_cancel_conflicts_without_cancelling_new_run() {
    let (_root, state, draft) = super::super::tests::fixture();
    let stale = state.read(&draft).unwrap().diagnostics.remove(0);
    let token = CancellationToken::new();
    state
        .running
        .lock()
        .unwrap()
        .insert(draft.clone(), token.clone());
    state
        .update(&draft, None, |r| {
            record_mut(r, &stale.id)?.run_id = "new-run".into();
            Ok(())
        })
        .unwrap();
    let before = serde_json::to_value(state.read(&draft).unwrap()).unwrap();
    assert!(matches!(
        cancel_run(&state, &draft, &stale.id, &stale.run_id),
        Err(ProjectError::Conflict)
    ));
    assert!(!token.is_cancelled());
    assert_eq!(
        serde_json::to_value(state.read(&draft).unwrap()).unwrap(),
        before
    );
}

#[test]
fn matching_run_cancel_publishes_cancelling_and_signals_token() {
    let (_root, state, draft) = super::super::tests::fixture();
    let token = CancellationToken::new();
    state
        .running
        .lock()
        .unwrap()
        .insert(draft.clone(), token.clone());
    cancel_run(&state, &draft, "session", "run").unwrap();
    assert_eq!(
        state.read(&draft).unwrap().diagnostics[0].status,
        DiagnosticStatus::Cancelling
    );
    assert!(token.is_cancelled());
}

#[test]
fn stale_run_conflicts_even_when_current_run_is_terminal() {
    let mut d = record();
    d.status = DiagnosticStatus::Cancelled;
    assert!(matches!(
        mark_cancelling(&mut d, "old-run"),
        Err(ProjectError::Conflict)
    ));
    assert_eq!(d.status, DiagnosticStatus::Cancelled);
}
