<script setup lang="ts">
import { TMDBImage } from '@/components/image';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Slider } from '@/components/ui/slider';
import { IConfig, IEpisode, IMovie, ISeason, ITrack, ITracks, ITvShow } from '@/utils/types';
import { invoke } from '@tauri-apps/api/core';
import { fetch } from '@tauri-apps/plugin-http';
import { useEventListener, useGamepad, useScreenOrientation } from '@vueuse/core';
import { ChevronLeft, GalleryVerticalEnd, Maximize, MessageSquareText, Minimize, Pause, Play, RotateCcw, RotateCw, Volume1, Volume2, VolumeX } from 'lucide-vue-next';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getNameByISO6392B } from '@/utils/languages';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { computed } from 'vue';
import { getTvShowFromEpisode } from '@/utils/video';
import { ScrollArea } from '@/components/ui/scroll-area';
import useStore from '@/lib/stores';
import JASSUB from 'jassub';
import workerUrl from 'jassub/dist/jassub-worker.js?url';
import wasmUrl from 'jassub/dist/jassub-worker.wasm?url';

const router = useRouter();
const route = useRoute();

const store = useStore();
const config = ref<IConfig | null>(null);

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

const movieLogo = ref<string | null>(null);

const tvShow = ref<ITvShow | null>(null);
const currentSeason = ref<ISeason | null>(null);
const nextEpisode = ref<IEpisode | null>(null);

const videoItem = ref<IMovie | IEpisode | null>(null);
const videoElem = ref<HTMLVideoElement>();
const sourceElem = ref<HTMLSourceElement | null>(null);
const playing = ref(false);
const showControls = ref(true);
const controlsBox = ref<HTMLDivElement | null>(null);
const progressValue = ref([0]);
const isFullscreen = ref(false);
const isUserSliding = ref(false);
const isHoveringVolume = ref(false);
const playerVolume = ref([1]);
// const audioTracks = ref([]); // Here but currently not supported https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/audioTracks#browser_compatibility
const subtitles = ref<ITrack[]>([]);
const currentSubtitle = ref(-1);
const isHoveringTracks = ref(false);
const isHoveringSeasons = ref(false);
const isEnding = ref(false);
const jassubRenderer = ref<JASSUB | null>(null);

const { isSupported, gamepads } = useGamepad();
const gamepad = computed(() => gamepads.value.find(g => g.mapping === 'standard'));

const { lockOrientation } = useScreenOrientation();

let hideControlsTimeout: ReturnType<typeof setTimeout>;

const formatTime = (seconds: number): string => {
  const hrs = ~~(seconds / 3600);
  const mins = ~~((seconds % 3600) / 60);
  const secs = ~~seconds % 60;
  if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  else return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const startHideControlsTimer = () => {
  if (hideControlsTimeout) clearTimeout(hideControlsTimeout);
  hideControlsTimeout = setTimeout(() => {
    if (playing.value) showControls.value = false;
  }, 5000);
}

const resetControlsTimer = () => {
  showControls.value = true;
  startHideControlsTimer();
}

const changeProgress = (delta: number) => {
  if (videoElem.value) videoElem.value.currentTime += delta;
};

const togglePlaying = () => {
  if (!videoElem.value) return;
  playing.value = !playing.value;
  if (playing.value) {
    videoElem.value.play();
    startHideControlsTimer();
  } else {
    videoElem.value.pause();
    resetControlsTimer();
  }
};

const toggleFullscreen = async (state: boolean) => {
  if (isMobile) {
    lockOrientation("landscape");
    if (videoElem.value) {
      if (state) await videoElem.value.requestFullscreen();
      else await document.exitFullscreen();
    }
    isFullscreen.value = state;
  } else {
    const appwindow = getCurrentWindow();
    const isAppFullscreen = await appwindow.isFullscreen();
    await appwindow.setFullscreen(state ?? !isAppFullscreen);
    isFullscreen.value = state ?? !isAppFullscreen;
  }
};

const useSubtitleTrack = (index: number = -1) => {
  if (config.value && videoElem.value && subtitles.value && subtitles.value.length > 0) {
    for (let i = 0; i < subtitles.value.length; i++) {
      const track = subtitles.value[i];
      const trackElem = videoElem.value.textTracks[i];
      if (index === -1) {
        if (jassubRenderer.value) jassubRenderer.value.freeTrack();
        else trackElem.mode = 'disabled';
      }
      else if (i === index) {
        if (track.codec_name && track.codec_name === 'ass') {
          if (!jassubRenderer.value) jassubRenderer.value = new JASSUB({
            video: videoElem.value,
            subUrl: `${config.value.http_server}${track.url}`,
            workerUrl,
            wasmUrl,
          });
          else jassubRenderer.value.setTrackByUrl(`${config.value.http_server}${track.url}`);
        } else trackElem.mode = 'showing';
      }
      else {
        if (jassubRenderer.value) jassubRenderer.value.freeTrack();
        else trackElem.mode = 'hidden';
      }
    }
    currentSubtitle.value = index;
  }
};

const nextVideo = async () => {
  if (nextEpisode.value) {
    store.setProgress(nextEpisode.value, 0, false);
    router.push({ path: `/watch/${nextEpisode.value.id}`, replace: true });
  }
};

const changeVolume = (delta: number) => {
  playerVolume.value = [Math.min(Math.max(playerVolume.value[0] + delta, 0), 1)];
};

useEventListener(document, 'mousemove', () => {
  if (playing.value) resetControlsTimer();
});

useEventListener(document, 'click', (event) => {
  if (isHoveringTracks.value) return;
  if (tvShow.value && isHoveringSeasons.value) return;
  if (controlsBox.value) {
    const bbox = controlsBox.value.getBoundingClientRect();
    if (!(event.clientX >= bbox.left && event.clientX <= bbox.right && event.clientY >= bbox.top && event.clientY <= bbox.bottom)) togglePlaying();
  }
});

useEventListener(document, 'keydown', (event) => {
  if (!videoElem.value) return;
  if (event.key === ' ' || event.key === 'k' || event.key === 'MediaPlayPause') togglePlaying();
  if (event.key === 'm') playerVolume.value = [playerVolume.value[0] === 0 ? 1 : 0];
  if (event.key === 'f') toggleFullscreen(!isFullscreen.value);
  if (event.key === 'Escape') toggleFullscreen(false);
  if (event.key === 'ArrowLeft' || event.key === 'j') changeProgress(-10);
  if (event.key === 'ArrowRight' || event.key === 'l') changeProgress(10);
  if (event.key === 'ArrowUp') changeVolume(0.1);
  if (event.key === 'ArrowDown') changeVolume(-0.1);
  if (event.key === '0') videoElem.value.currentTime = 0;
  if (event.key === '1') videoElem.value.currentTime = videoElem.value?.duration * 0.1;
  if (event.key === '2') videoElem.value.currentTime = videoElem.value?.duration * 0.2;
  if (event.key === '3') videoElem.value.currentTime = videoElem.value?.duration * 0.3;
  if (event.key === '4') videoElem.value.currentTime = videoElem.value?.duration * 0.4;
  if (event.key === '5') videoElem.value.currentTime = videoElem.value?.duration * 0.5;
  if (event.key === '6') videoElem.value.currentTime = videoElem.value?.duration * 0.6;
  if (event.key === '7') videoElem.value.currentTime = videoElem.value?.duration * 0.7;
  if (event.key === '8') videoElem.value.currentTime = videoElem.value?.duration * 0.8;
  if (event.key === '9') videoElem.value.currentTime = videoElem.value?.duration * 0.9;
});

watch(progressValue, () => {
  if (isUserSliding.value && videoElem.value) videoElem.value.currentTime = videoElem.value.duration * progressValue.value[0] / 100;
});

watch(playerVolume, () => {
  if (videoElem.value) videoElem.value.volume = playerVolume.value[0];
});

const gamepadInterval = setInterval(() => {
  if (!isSupported.value) return;
  if (!gamepad.value) return;
  if (!videoElem.value) return;
  if (gamepad.value.buttons[0].pressed) togglePlaying(); // A or Cross
  if (gamepad.value.buttons[1].pressed) playerVolume.value = [playerVolume.value[0] === 0 ? 1 : 0]; // B or Circle
  if (gamepad.value.buttons[3].pressed) toggleFullscreen(!isFullscreen.value); // Y or Triangle
  if (gamepad.value.buttons[4].pressed || gamepad.value.axes[0] < -0.5) changeProgress(-10); // L1 or L Stick Left
  if (gamepad.value.buttons[5].pressed || gamepad.value.axes[0] > 0.5) changeProgress(10); // R1 or L Stick Right
  const currentVideoTime = videoElem.value.currentTime;
  if (gamepad.value.buttons[6].pressed) { // L2
    const percentageBackward = Math.floor(currentVideoTime / videoElem.value.duration * 10) / 10;
    videoElem.value.currentTime = videoElem.value.duration * (percentageBackward - 0.1);
  }
  if (gamepad.value.buttons[7].pressed) { // R2
    const percentageForward = Math.ceil(currentVideoTime / videoElem.value.duration * 10) / 10;
    videoElem.value.currentTime = videoElem.value.duration * percentageForward;
  }
  if (gamepad.value.buttons[12].pressed) changeVolume(0.1); // D-Pad Up
  if (gamepad.value.buttons[13].pressed) changeVolume(-0.1); // D-Pad Down
}, 100);

const loadData = async () => {
  void store.$tauri.start();
  config.value = await invoke<IConfig | null>("get_config");

  if (config.value) {
    const route = router.currentRoute.value;
    const videoId = route.params.id;
    if (!videoId) router.push({ path: '/browse' });

    const details = await fetch(config.value.http_server + `/details?id=${videoId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    if (details.ok) {
      videoItem.value = await details.json();

      if (!isMobile) {
        const appwindow = getCurrentWindow();
        isFullscreen.value = await appwindow.isFullscreen();
      }

      if (videoItem.value) {
        if ('logo_path' in videoItem.value) movieLogo.value = videoItem.value.logo_path;
        if ('episode_number' in videoItem.value) {
          const tvShowResult = await getTvShowFromEpisode(videoItem.value.id);
          if (tvShowResult) {
            tvShow.value = tvShowResult;
            movieLogo.value = tvShowResult.logo_path;
            const season = tvShow.value.seasons.find(season => season.episodes.find(episode => episode.id === videoItem.value!.id));
            if (season) currentSeason.value = season;
            if (currentSeason.value && videoItem.value) {
              const videoItemId = videoItem.value.id;
              const episodeIndex = currentSeason.value.episodes.findIndex(episode => episode.id === videoItemId);
              if (episodeIndex !== -1 && episodeIndex < currentSeason.value.episodes.length - 1) nextEpisode.value = currentSeason.value.episodes[episodeIndex + 1];
            }
          }
        };

        if (sourceElem.value && videoElem.value) {
          sourceElem.value.src = config.value.http_server + `/video?id=${videoId}`;
          videoElem.value.setAttribute('crossorigin', 'anonymous');

          const tracksRes = await fetch(config.value.http_server + `/tracks?id=${videoId}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          });
          if (tracksRes.ok) {
            const tracksData = await tracksRes.json();
            const tracks = tracksData.tracks as ITracks;
            if (tracks.subtitles) {
              for (const subtitle of tracks.subtitles) {
                if (subtitle.codec_name && subtitle.codec_name === 'ass') {
                  if (!jassubRenderer.value) jassubRenderer.value = new JASSUB({
                    video: videoElem.value,
                    subUrl: `${config.value.http_server}${subtitle.url}`,
                    workerUrl,
                    wasmUrl,
                  });
                  else jassubRenderer.value.setTrackByUrl(`${config.value.http_server}${subtitle.url}`);
                }

                const trackElement = document.createElement('track');
                trackElement.className = 'font-bold text-white';
                trackElement.src = `${config.value.http_server}${subtitle.url}`;
                trackElement.label = getNameByISO6392B(subtitle.language);
                trackElement.srclang = subtitle.language;
                trackElement.default = subtitle.default ?? false;
                currentSubtitle.value = subtitle.default ? tracks.subtitles.indexOf(subtitle) : -1;
                trackElement.kind = 'subtitles';
                videoElem.value.appendChild(trackElement);

                currentSubtitle.value = tracks.subtitles.findIndex(sub => sub.default);
              }
              subtitles.value = tracks.subtitles;
            }
          }

          videoElem.value.load();

          videoElem.value.onloadedmetadata = async () => {
            if (!videoElem.value || !videoItem.value) return;
            const lastTime = store.getProgress(videoItem.value);
            videoElem.value.currentTime = lastTime ?? 0;
            videoElem.value.play();
            changeVolume(1);
            playing.value = true;
          };

          videoElem.value.ontimeupdate = async () => {
            if (!videoElem.value || isUserSliding.value || !videoItem.value) return;
            progressValue.value = [videoElem.value.currentTime / videoElem.value.duration * 100];
            const currentTime = Math.floor(videoElem.value.currentTime);
            if (currentTime !== 0 && currentTime % 5 === 0) store.setProgress(videoItem.value, currentTime);
            if (videoElem.value.duration - videoElem.value.currentTime <= 30) isEnding.value = true;
            else isEnding.value = false;
          };

          videoElem.value.onplaying = () => {
            if (!videoElem.value) return;
            playing.value = true;
            startHideControlsTimer();
          };

          videoElem.value.onended = async () => {
            if (!videoElem.value || !videoItem.value) return;
            store.setProgress(videoItem.value, videoElem.value.duration, true);
            if (nextEpisode.value) {
              store.setProgress(nextEpisode.value, 0, false);
              router.push({ path: `/watch/${nextEpisode.value.id}`, replace: true });
            } else router.push({ path: '/browse' });
          };
        }
      }
    }
    else router.push({ path: '/browse' });
  }
  else router.push({ path: "/register" });
};

onMounted(loadData);

watch(route, loadData);

onUnmounted(() => {
  if (videoElem.value) {
    videoElem.value.pause();
    videoElem.value.src = '';
    videoElem.value.load();
    if (jassubRenderer.value) jassubRenderer.value.destroy();
  }
  toggleFullscreen(false);
  clearInterval(gamepadInterval);
});
</script>

<template>
  <div class="w-screen h-screen flex flex-col justify-center items-center relative overflow-hidden" :class="{ 'cursor-none': !showControls }">
    <div class="w-full">
      <video ref="videoElem" class="w-screen h-screen">
        <source ref="sourceElem" type="video/mp4" />
      </video>
    </div>
    <div v-if="videoItem" class="absolute top-0 left-0 w-full h-full flex flex-col justify-between p-8 transition-colors" :class="{ 'bg-background/25': showControls }">
      <div v-show="showControls" class="flex">
        <ChevronLeft class="cursor-pointer" @click="router.go(-1)" />
      </div>
      <div v-show="!playing" class="flex flex-col gap-4">
        <TMDBImage
          v-if="movieLogo"
          :image="movieLogo"
          :alt="videoItem.title"
          type="logo"
          size="original"
          class="w-[20vw] h-auto object-cover"
        />
        <h1 v-else class="drop-shadow-lg text-4xl font-bold">
          {{ ('episode_number' in videoItem && tvShow) ? tvShow.title : videoItem.title }}
        </h1>
        <h2 v-if="tvShow && currentSeason && ('episode_number' in videoItem)" class="drop-shadow-lg text-2xl">
          {{ 
            $t('pages.watch.episode', {
              season: currentSeason.season_number,
              episode: videoItem.episode_number,
              title: videoItem.title
            })
          }}
        </h2>
      </div>
      <div v-show="showControls" ref="controlsBox" class="flex flex-col gap-4">
        <div v-if="tvShow" class="flex justify-end">
          <Button v-if="nextEpisode && isEnding" @click="nextVideo">
            <span>{{ $t('pages.watch.next') }}</span>
          </Button>
        </div>
        <Slider
          v-model="progressValue"
          ref="slider"
          class="w-full"
          :max="100"
          :step="0.01"
          @pointerdown="() => isUserSliding = true"
          @pointerup="() => isUserSliding = false"
        />
        <div class="relative flex justify-between">
          <div v-if="videoElem" class="flex gap-4">
            <span>{{ formatTime(videoElem.currentTime) }} / {{ formatTime(videoElem.duration) }}</span>
          </div>
          <div class="absolute left-1/2 transform -translate-x-1/2 flex gap-4">
            <RotateCcw @click="changeProgress(-10);" class="cursor-pointer" />
            <component :is="playing ? Pause : Play" class="cursor-pointer" @click="togglePlaying" />
            <RotateCw @click="changeProgress(-10);" class="cursor-pointer" />
          </div>
          <div class="flex gap-4">
            <div
              v-if="!isMobile"
              class="flex gap-4"
              @mouseenter="() => isHoveringVolume = true"
              @mouseleave="() => isHoveringVolume = false"
            >
              <Slider
                v-if="isHoveringVolume"
                v-model="playerVolume"
                class="w-32"
                :max="1"
                :step="0.01"
              />
              <component :is="playerVolume[0] === 0 ? VolumeX : playerVolume[0] < 0.5 ? Volume1 : Volume2" class="cursor-pointer" @click="() => playerVolume = [playerVolume[0] === 0 ? 0.5 : 0]" />
            </div>
            <HoverCard v-if="subtitles && subtitles.length > 0" v-model:open="isHoveringTracks">
              <HoverCardTrigger as-child>
                <MessageSquareText class="cursor-pointer" />
              </HoverCardTrigger>
              <HoverCardContent class="flex flex-col gap-4">
                <span>{{ $t('pages.watch.subtitles') }}</span>
                <Button :variant="currentSubtitle === -1 ? 'outline': 'ghost'" :key="'none'" @click="() => useSubtitleTrack(-1)">
                  {{ $t('pages.watch.track_none') }}
                </Button>
                <Button
                  v-for="(track, index) in subtitles" :key="index" @click="() => useSubtitleTrack(index)"
                  :variant="currentSubtitle === index ? 'outline': 'ghost'"
                >
                  {{ `${getNameByISO6392B(track.language)}${track.language ? `- ${track.language}` : ''}` }}
                </Button>
              </HoverCardContent>
            </HoverCard>
            <HoverCard v-if="tvShow && currentSeason && ('episode_number' in videoItem)" v-model:open="isHoveringSeasons">
              <HoverCardTrigger as-child>
                <GalleryVerticalEnd class="cursor-pointer" />
              </HoverCardTrigger>
              <HoverCardContent class="flex flex-col gap-4 w-screen sm:w-[32rem]">
                <Button variant="ghost">
                  {{ $t('pages.watch.season', { season: currentSeason.season_number }) }}
                </Button>
                <ScrollArea class="w-full h-64">
                  <div
                    v-for="(episode, index) in currentSeason.episodes"
                    :key="episode.id"
                    class="flex flex-col gap-4 p-4 rounded-md transition-colors \
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 cursor-pointer"
                    :class="{
                      'hover:bg-accent hover:text-accent-foreground': episode.id !== videoItem.id,
                      'border border-input bg-background hover:bg-accent hover:text-accent-foreground': episode.id === videoItem.id,
                      'my-4': index !== 0 && index !== currentSeason.episodes.length - 1,
                      'mb-4': index === 0,
                      'mt-4': index === currentSeason.episodes.length - 1,
                    }"
                    @click="() => router.push({ path: `/watch/${episode.id}`, replace: true })"
                  >
                    <span>{{ episode.episode_number }}. {{ episode.title }}</span>
                    <div class="flex gap-4 items-start">
                      <TMDBImage
                        v-if="episode.still_path"
                        :image="episode.still_path"
                        :alt="episode.title"
                        type="still"
                        size="w300"
                        class="w-48 h-auto object-cover flex-shrink-0"
                      />
                      <span class="flex-1">
                        {{ episode.overview }}
                      </span>
                    </div>
                  </div>
                </ScrollArea>
              </HoverCardContent>
            </HoverCard>
            <component v-if="!isMobile" :is="isFullscreen ? Minimize : Maximize" class="cursor-pointer" @click="() => toggleFullscreen(!isFullscreen)" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>