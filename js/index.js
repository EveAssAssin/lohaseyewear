document.addEventListener('DOMContentLoaded', () => {
    // ======== 第一組：OWNDAYS 小卡 (母親節/市集) ========
    const container1 = document.getElementById('owndays-container');
    const prevBtn1 = document.querySelector('.prev-btn');
    const nextBtn1 = document.querySelector('.next-btn');

    if (container1 && prevBtn1 && nextBtn1) {
        prevBtn1.addEventListener('click', () => {
            const cardWidth = container1.children[0].offsetWidth + 15;
            container1.scrollBy({ left: -cardWidth, behavior: 'smooth' });
        });

        nextBtn1.addEventListener('click', () => {
            const cardWidth = container1.children[0].offsetWidth + 15;
            container1.scrollBy({ left: cardWidth, behavior: 'smooth' });
        });
    }

    // ======== 第二組：新增的小卡 (商店街/AI鏡片) ========
    const container2 = document.getElementById('extra-cards-container');
    const prevBtn2 = document.querySelector('.prev-btn-2');
    const nextBtn2 = document.querySelector('.next-btn-2');

    if (container2 && prevBtn2 && nextBtn2) {
        prevBtn2.addEventListener('click', () => {
            const cardWidth = container2.children[0].offsetWidth + 15;
            container2.scrollBy({ left: -cardWidth, behavior: 'smooth' });
        });

        nextBtn2.addEventListener('click', () => {
            const cardWidth = container2.children[0].offsetWidth + 15;
            container2.scrollBy({ left: cardWidth, behavior: 'smooth' });
        });
    }
});
