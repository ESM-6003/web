(function ($) {
    "use strict";

    function bindCarouselStability($carousels) {
        $carousels.each(function () {
            var $carousel = $(this);

            if ($carousel.hasClass('js-carousel-stable')) {
                return;
            }

            $carousel.addClass('js-carousel-stable');

            $carousel.on('drag.owl.carousel', function () {
                $carousel.addClass('is-dragging');
            });

            $carousel.on('dragged.owl.carousel translated.owl.carousel', function () {
                setTimeout(function () {
                    $carousel.removeClass('is-dragging');
                }, 50);
            });
        });
    }

    function syncCarouselAutoplayByViewport($carousels) {
        if (!$carousels || !$carousels.length) {
            return;
        }

        var isMobile = window.matchMedia('(max-width: 767.98px)').matches;

        $carousels.each(function () {
            var $carousel = $(this);

            if (!$carousel.hasClass('owl-loaded')) {
                return;
            }

            if (isMobile) {
                $carousel.trigger('stop.owl.autoplay');
            } else {
                $carousel.trigger('play.owl.autoplay', [3500]);
            }
        });
    }
    
    // Dropdown on mouse hover
    $(document).ready(function () {
        function toggleNavbarMethod() {
            if ($(window).width() > 992) {
                $('.navbar .dropdown').on('mouseover', function () {
                    $('.dropdown-toggle', this).trigger('click');
                }).on('mouseout', function () {
                    $('.dropdown-toggle', this).trigger('click').blur();
                });
            } else {
                $('.navbar .dropdown').off('mouseover').off('mouseout');
            }
        }
        toggleNavbarMethod();
        $(window).resize(toggleNavbarMethod);
    });
    
    
    // Back to top button
    $(window).scroll(function () {
        if ($(this).scrollTop() > 100) {
            $('.back-to-top').fadeIn('slow');
        } else {
            $('.back-to-top').fadeOut('slow');
        }
    });
    $('.back-to-top').click(function () {
        $('html, body').animate({scrollTop: 0}, 1500, 'easeInOutExpo');
        return false;
    });


    // Facts counter
    $('[data-toggle="counter-up"]').counterUp({
        delay: 10,
        time: 2000
    });


    // Courses carousel
    var $coursesCarousel = $(".courses-carousel");

    if ($coursesCarousel.length) {
        $coursesCarousel.owlCarousel({
            autoplay: true,
            smartSpeed: 1500,
            loop: true,
            dots: false,
            nav : true,
            navText : [
                '<i class="fa fa-angle-left" aria-hidden="true"></i>',
                '<i class="fa fa-angle-right" aria-hidden="true"></i>'
            ],
            responsive: {
                0:{
                    items:1
                },
                576:{
                    items:2
                },
                768:{
                    items:3
                },
                992:{
                    items:4
                }
            }
        });

        bindCarouselStability($coursesCarousel);
        syncCarouselAutoplayByViewport($coursesCarousel);
    }


    function initVideosCarousel() {
        var $videosCarousel = $('.videos-carousel');

        if (!$videosCarousel.length || $videosCarousel.hasClass('owl-loaded')) {
            return;
        }

        $videosCarousel.owlCarousel({
            autoplay: true,
            smartSpeed: 1500,
            loop: true,
            dots: false,
            nav: true,
            navText: [
                '<i class="fa fa-angle-left" aria-hidden="true"></i>',
                '<i class="fa fa-angle-right" aria-hidden="true"></i>'
            ],
            responsive: {
                0: {
                    items: 1
                },
                576: {
                    items: 2
                },
                768: {
                    items: 3
                },
                992: {
                    items: 4
                }
            }
        });

        bindCarouselStability($videosCarousel);
        syncCarouselAutoplayByViewport($videosCarousel);
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderVideosMessage(message) {
        var $carousel = $('#youtubePlaylistCarousel');

        if (!$carousel.length) {
            return;
        }

        $carousel.html(
            '<div class="courses-item position-relative youtube-video-item youtube-video-placeholder">' +
                '<img class="img-fluid" src="img/courses-1.jpg" alt="Videos de YouTube">' +
                '<div class="courses-text">' +
                    '<h4 class="text-center text-white px-3">' + escapeHtml(message) + '</h4>' +
                    '<div class="w-100 bg-white text-center p-4">' +
                        '<span class="btn btn-primary disabled">Sin videos</span>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        initVideosCarousel();
    }

    function getPlaylistIdFromInput(input) {
        var value = String(input || '').trim();

        if (!value) {
            return '';
        }

        if (value.indexOf('youtube.com') !== -1 || value.indexOf('youtu.be') !== -1) {
            try {
                var url = new URL(value);
                return url.searchParams.get('list') || '';
            } catch (e) {
                return '';
            }
        }

        return value;
    }

    function getVideoIdFromLink(link) {
        try {
            var url = new URL(link);
            return url.searchParams.get('v') || '';
        } catch (e) {
            return '';
        }
    }

    function loadYouTubePlaylistVideos() {
        var $carousel = $('#youtubePlaylistCarousel');

        if (!$carousel.length) {
            return;
        }

        var playlistInput = $carousel.attr('data-playlist-id');
        var playlistId = getPlaylistIdFromInput(playlistInput);

        if (!playlistId) {
            renderVideosMessage('No se encontro el ID de playlist.');
            return;
        }

        var rssUrl = 'https://www.youtube.com/feeds/videos.xml?playlist_id=' + encodeURIComponent(playlistId);
        var proxyUrl = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(rssUrl);

        fetch(proxyUrl)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('No se pudo consultar el feed de YouTube.');
                }
                return response.json();
            })
            .then(function (data) {
                if (!data || data.status !== 'ok' || !Array.isArray(data.items)) {
                    throw new Error('Respuesta invalida del feed de YouTube.');
                }

                var items = data.items.slice(0, 10);

                if (!items.length) {
                    renderVideosMessage('No hay videos disponibles en esta playlist.');
                    return;
                }

                var cardsHtml = items.map(function (item) {
                    var videoTitle = escapeHtml(item.title || 'Video institucional');
                    var videoLink = item.link || '#';
                    var videoId = getVideoIdFromLink(videoLink);
                    var thumbUrl = videoId
                        ? 'https://i.ytimg.com/vi/' + encodeURIComponent(videoId) + '/hqdefault.jpg'
                        : 'img/courses-1.jpg';

                    return (
                        '<div class="courses-item position-relative youtube-video-item youtube-video-trigger" data-video-id="' + escapeHtml(videoId) + '" data-video-title="' + videoTitle + '" role="button" tabindex="0" aria-label="Reproducir ' + videoTitle + '">' +
                            '<img class="img-fluid" src="' + thumbUrl + '" alt="' + videoTitle + '">' +
                            '<div class="courses-text">' +
                                '<span class="youtube-play-indicator" aria-hidden="true"><i class="fa fa-play"></i></span>' +
                                '<h4 class="text-center text-white px-3">' + videoTitle + '</h4>' +
                            '</div>' +
                        '</div>'
                    );
                }).join('');

                $carousel.html(cardsHtml);
                initVideosCarousel();
            })
            .catch(function () {
                renderVideosMessage('No fue posible cargar la playlist en este momento.');
            });
    }

    function setupYouTubeModalPlayer() {
        var $modal = $('#youtubeVideoModal');
        var $frame = $('#youtubeVideoFrame');
        var $title = $('#youtubeVideoModalTitle');

        if (!$modal.length || !$frame.length) {
            return;
        }

        $(document).on('click keydown', '.youtube-video-trigger', function (event) {
            if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') {
                return;
            }

            event.preventDefault();

            var $card = $(this);

            if ($card.closest('.owl-carousel').hasClass('is-dragging')) {
                return;
            }

            var videoId = String($card.data('video-id') || '').trim();
            var videoTitle = String($card.data('video-title') || 'Reproduciendo video');

            if (!videoId) {
                return;
            }

            $title.text(videoTitle);
            $frame.attr('src', 'https://www.youtube.com/embed/' + encodeURIComponent(videoId) + '?autoplay=1&rel=0');
            $modal.modal('show');
        });

        $modal.on('hidden.bs.modal', function () {
            $frame.attr('src', 'about:blank');
        });
    }

    function setupLicenciasDocentesToggle() {
        var $summaryRows = $('.license-summary-row');

        if (!$summaryRows.length) {
            return;
        }

        function closeOtherRows($currentRow) {
            $summaryRows.not($currentRow).each(function () {
                var $row = $(this);
                var targetId = String($row.data('license-target') || '');

                if (!targetId) {
                    return;
                }

                $('#' + targetId).prop('hidden', true);
                $row.removeClass('is-open').attr('aria-expanded', 'false');
                $row.find('.license-row-toggle').attr('aria-expanded', 'false');
            });
        }

        function toggleRow($row) {
            var targetId = String($row.data('license-target') || '');
            var $detailRow = $('#' + targetId);

            if (!targetId || !$detailRow.length) {
                return;
            }

            var isOpen = !$detailRow.prop('hidden');

            closeOtherRows($row);

            $detailRow.prop('hidden', isOpen);
            $row.toggleClass('is-open', !isOpen);
            $row.attr('aria-expanded', String(!isOpen));
            $row.find('.license-row-toggle').attr('aria-expanded', String(!isOpen));
        }

        $summaryRows.on('click', function (event) {
            if ($(event.target).closest('.license-row-toggle').length) {
                return;
            }

            toggleRow($(this));
        });

        $summaryRows.on('keydown', function (event) {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }

            event.preventDefault();
            toggleRow($(this));
        });

        $(document).on('click', '.license-row-toggle', function (event) {
            event.preventDefault();
            toggleRow($(this).closest('.license-summary-row'));
        });
    }

    loadYouTubePlaylistVideos();
    setupYouTubeModalPlayer();
    setupLicenciasDocentesToggle();


    // Team carousel
    var $teamCarousel = $(".team-carousel");

    if ($teamCarousel.length) {
        $teamCarousel.owlCarousel({
            autoplay: true,
            smartSpeed: 1000,
            margin: 30,
            dots: false,
            loop: true,
            nav : true,
            navText : [
                '<i class="fa fa-angle-left" aria-hidden="true"></i>',
                '<i class="fa fa-angle-right" aria-hidden="true"></i>'
            ],
            responsive: {
                0:{
                    items:1
                },
                576:{
                    items:1
                },
                768:{
                    items:2
                },
                992:{
                    items:3
                }
            }
        });

        bindCarouselStability($teamCarousel);
        syncCarouselAutoplayByViewport($teamCarousel);
    }


    // Testimonials carousel
    var $testimonialCarousel = $(".testimonial-carousel");

    if ($testimonialCarousel.length) {
        $testimonialCarousel.owlCarousel({
            autoplay: true,
            smartSpeed: 1500,
            items: 1,
            dots: false,
            loop: true,
            nav : true,
            navText : [
                '<i class="fa fa-angle-left" aria-hidden="true"></i>',
                '<i class="fa fa-angle-right" aria-hidden="true"></i>'
            ],
        });

        bindCarouselStability($testimonialCarousel);
        syncCarouselAutoplayByViewport($testimonialCarousel);
    }


    // Related carousel
    var $relatedCarousel = $(".related-carousel");

    if ($relatedCarousel.length) {
        $relatedCarousel.owlCarousel({
            autoplay: true,
            smartSpeed: 1000,
            margin: 30,
            dots: false,
            loop: true,
            nav : true,
            navText : [
                '<i class="fa fa-angle-left" aria-hidden="true"></i>',
                '<i class="fa fa-angle-right" aria-hidden="true"></i>'
            ],
            responsive: {
                0:{
                    items:1
                },
                576:{
                    items:1
                },
                768:{
                    items:2
                }
            }
        });

        bindCarouselStability($relatedCarousel);
        syncCarouselAutoplayByViewport($relatedCarousel);
    }

    var resizeRefreshTimer;
    $(window).on('resize orientationchange', function () {
        clearTimeout(resizeRefreshTimer);
        resizeRefreshTimer = setTimeout(function () {
            var $loadedCarousels = $('.owl-carousel.owl-loaded');
            $loadedCarousels.trigger('refresh.owl.carousel');
            syncCarouselAutoplayByViewport($loadedCarousels);
        }, 150);
    });
    
})(jQuery);

