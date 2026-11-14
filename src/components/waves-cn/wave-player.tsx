// Adapted from waves-cn Wave Player (MIT):
// https://github.com/Ziane-Badreddine/waves-cn
import { Trans, useLingui } from "@lingui/react/macro";
import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import {
  formatTime,
  useWavePlayer,
  type WavePlayerOptions,
} from "@/lib/wave-cn";

export type WavePlayerProps = WavePlayerOptions;

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];

export default function WavePlayer({
  src,
  media,
  peaks,
  duration,
  onError,
}: WavePlayerProps) {
  const { t } = useLingui();
  const player = useWavePlayer({ src, media, peaks, duration, onError });
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-4">
        <Button
          size="icon-lg"
          disabled={!player.isReady}
          onClick={player.togglePlay}
          aria-label={
            player.isPlaying
              ? t({ comment: "试听播放器暂停按钮", message: "暂停" })
              : t({ comment: "试听播放器播放按钮", message: "播放" })
          }
        >
          {player.isPlaying ? <Pause /> : <Play />}
        </Button>
        <div className="min-w-0 flex-1">
          <div className="relative h-12">
            {!player.isReady && <Skeleton className="absolute inset-0" />}
            <div ref={player.container} />
          </div>
        </div>
        <span className="text-muted-foreground min-w-24 text-right text-xs tabular-nums">
          {formatTime(player.currentTime)} / {formatTime(duration)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!player.isReady}
          aria-label={t({
            comment: "试听播放器回到音频开头",
            message: "从头播放",
          })}
          onClick={player.restart}
        >
          <RotateCcw />
        </Button>
        <Slider
          className="min-w-24 flex-1"
          value={[player.progress]}
          min={0}
          max={1}
          step={0.001}
          getAriaValueText={(_, value) =>
            `${formatTime(value * duration)} / ${formatTime(duration)}`
          }
          disabled={!player.isReady}
          onValueChange={(value) =>
            player.seek(Array.isArray(value) ? value[0] : value)
          }
          aria-label={t({
            comment: "试听播放器可用键盘调整的时间进度",
            message: "播放进度",
          })}
        />
        <Select
          value={player.rate}
          onValueChange={(next) => {
            if (next === null) return;
            player.setRate(next);
          }}
        >
          <SelectTrigger
            size="sm"
            disabled={!player.isReady}
            aria-label={t({
              comment: "试听播放器播放速度选项",
              message: "播放速度",
            })}
          >
            <SelectValue>{player.rate}×</SelectValue>
          </SelectTrigger>
          <SelectContent side="top">
            <SelectGroup>
              {PLAYBACK_RATES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}×
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <div className="flex w-28 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!player.isReady}
            onClick={player.toggleMute}
            aria-label={
              player.isMuted
                ? t({ comment: "试听播放器恢复声音", message: "取消静音" })
                : t({ comment: "试听播放器关闭声音", message: "静音" })
            }
          >
            {player.isMuted ? <VolumeX /> : <Volume2 />}
          </Button>
          <Slider
            value={[player.isMuted ? 0 : player.volume]}
            min={0}
            max={1}
            step={0.01}
            getAriaValueText={(_, value) => `${Math.round(value * 100)}%`}
            disabled={!player.isReady}
            onValueChange={(value) =>
              player.setVolume(Array.isArray(value) ? value[0] : value)
            }
            aria-label={t({ comment: "试听播放器音量滑块", message: "音量" })}
          />
        </div>
        <span className="sr-only" role="status">
          {!player.isReady && (
            <Trans comment="试听波形播放器准备中">正在加载音频…</Trans>
          )}
        </span>
      </div>
    </div>
  );
}
