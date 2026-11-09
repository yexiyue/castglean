//! Frozen generation defaults on the native wire, shared by unary and streaming consumers.
use rig_core::{
    completion::{CompletionRequest, GenerationOptions},
    error::EncodeError,
    operation::Completion,
    wire::{Descriptor, Mode, Wire},
};

#[derive(Clone)]
pub(super) struct Defaults<W> {
    pub wire: W,
    pub options: GenerationOptions,
}

impl<W: Wire<Op = Completion>> Wire for Defaults<W> {
    type Op = Completion;
    type Payload = W::Payload;
    type Frame = W::Frame;
    type Event = W::Event;
    type Decoder<'id> = W::Decoder<'id>;
    type Reassembler = W::Reassembler;

    fn describe(&self) -> Descriptor<'_> {
        self.wire.describe()
    }

    fn encode(
        &self,
        mut request: CompletionRequest,
        mode: Mode,
    ) -> Result<Self::Payload, EncodeError> {
        // Preserve request-specific options. No raw HTTP mutation or provider JSON templates.
        request.options = self.options.clone().overlay(&request.options);
        let descriptor = self.wire.describe();
        let target = descriptor
            .replay
            .ok_or_else(|| EncodeError::request("missing replay target"))?;
        // Rig's driver checked the original request before encode. Check the resolved defaults
        // too, so unsupported options can never bypass the native policy through this layer.
        let target = target.route(&request).unwrap_or(target);
        rig_core::completion::options::check(target, &mut request).map_err(EncodeError::request)?;
        self.wire.encode(request, mode)
    }

    fn decoder<'id>(&self) -> Self::Decoder<'id> {
        self.wire.decoder()
    }
    fn reassembler(&self) -> Self::Reassembler {
        self.wire.reassembler()
    }
}
